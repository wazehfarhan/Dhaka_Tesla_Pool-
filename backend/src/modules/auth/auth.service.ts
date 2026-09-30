import type { Database } from '../../db/client.js';
import {
  AppError,
  EmailTakenError,
  InvalidCredentialsError,
  NotFoundError,
  UnauthenticatedError,
} from '../../shared/errors.js';
import { REFRESH_TOKEN_TTL_MS } from './auth.constants.js';
import { createRefreshTokenRepository } from './refresh-token.repository.js';
import type { LoginInput, RegisterInput } from './auth.schemas.js';
import type { TokenService } from './token.service.js';
import { toUserProfile, type UserProfile } from './auth.types.js';
import { createUserRepository } from './user.repository.js';

export interface LoginResult {
  user: UserProfile;
  accessToken: string;
  refreshToken: string;
}

export interface RefreshResult {
  user: UserProfile;
  accessToken: string;
  refreshToken: string;
}

export interface AuthService {
  register(input: RegisterInput): Promise<UserProfile>;
  login(input: LoginInput): Promise<LoginResult>;
  refresh(rawToken: string | undefined): Promise<RefreshResult>;
  logout(rawToken: string | undefined): Promise<void>;
  getMe(userId: string): Promise<UserProfile>;
}

/** P2002 = unique constraint violation — the arbiter of the register race (database.md §9). */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
  );
}

/**
 * Auth business rules — security.md §1. HTTP stays in the controller; Prisma
 * stays in the repositories; this layer owns credentials, rotation and the
 * no-enumeration guarantees.
 */
export function createAuthService({
  database,
  tokens,
}: {
  database?: Database;
  tokens: TokenService;
}): AuthService {
  function prisma() {
    // Honest failure: with no database configured the endpoints answer 500 rather
    // than pretending to work (unit tests of other routes never reach this).
    if (!database) throw new AppError('INTERNAL', 'Database is not available.');
    return database.prisma;
  }

  /** Issue a new refresh row + raw cookie value for `userId`. */
  async function issueRefreshToken(userId: string): Promise<string> {
    const { token, jti } = tokens.signRefreshToken(userId);
    await createRefreshTokenRepository(prisma()).create({
      userId,
      jtiHash: tokens.hashTokenId(jti),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    });
    return token;
  }

  return {
    async register(input: RegisterInput): Promise<UserProfile> {
      const users = createUserRepository(prisma());
      if (await users.findByEmail(input.email)) throw new EmailTakenError();

      const passwordHash = await tokens.hashPassword(input.password);
      try {
        const user = await users.create({
          name: input.name,
          email: input.email,
          passwordHash,
          role: input.role,
        });
        return toUserProfile(user);
      } catch (error) {
        // Lost a concurrent race to the same email: the unique index decides.
        if (isUniqueViolation(error)) throw new EmailTakenError();
        throw error;
      }
    },

    async login({ email, password }: LoginInput): Promise<LoginResult> {
      const users = createUserRepository(prisma());
      const user = await users.findByEmail(email);

      if (!user) {
        // Burn one bcrypt round so an unknown email costs the same as a wrong
        // password — no timing oracle alongside the uniform 401 (security.md §1).
        await tokens.verifyPassword(password, await tokens.hashPassword(password));
        throw new InvalidCredentialsError();
      }
      if (!(await tokens.verifyPassword(password, user.passwordHash))) {
        throw new InvalidCredentialsError();
      }

      return {
        user: toUserProfile(user),
        accessToken: tokens.signAccessToken({ sub: user.id, role: user.role }),
        refreshToken: await issueRefreshToken(user.id),
      };
    },

    async refresh(rawToken: string | undefined): Promise<RefreshResult> {
      if (!rawToken) throw new UnauthenticatedError('Refresh cookie is missing.');

      // Forged/expired/wrong-type tokens die here with 401 UNAUTHENTICATED.
      const payload = tokens.verifyRefreshToken(rawToken);
      const refreshTokens = createRefreshTokenRepository(prisma());

      const row = await refreshTokens.findByJtiHash(tokens.hashTokenId(payload.jti));
      const now = new Date();
      if (!row || row.rotatedAt || row.revokedAt || row.expiresAt.getTime() <= now.getTime()) {
        // Rotated, revoked or expired are all "session over" — replays included.
        throw new UnauthenticatedError('Session expired. Please sign in again.');
      }

      const user = await createUserRepository(prisma()).findById(row.userId);
      if (!user) throw new UnauthenticatedError('Session expired. Please sign in again.');

      const next = tokens.signRefreshToken(user.id);
      await refreshTokens.rotate(row.id, {
        userId: user.id,
        jtiHash: tokens.hashTokenId(next.jti),
        expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
      });

      return {
        user: toUserProfile(user),
        accessToken: tokens.signAccessToken({ sub: user.id, role: user.role }),
        refreshToken: next.token,
      };
    },

    async logout(rawToken: string | undefined): Promise<void> {
      // Logout is idempotent: no cookie, or an unreadable one, has nothing to
      // revoke — the controller still clears the cookie either way.
      if (!rawToken) return;
      let payload;
      try {
        payload = tokens.verifyRefreshToken(rawToken);
      } catch {
        return;
      }

      const refreshTokens = createRefreshTokenRepository(prisma());
      const row = await refreshTokens.findByJtiHash(tokens.hashTokenId(payload.jti));
      if (row && !row.revokedAt) await refreshTokens.revoke(row.id);
    },

    async getMe(userId: string): Promise<UserProfile> {
      const user = await createUserRepository(prisma()).findById(userId);
      if (!user) throw new NotFoundError('User not found.');
      return toUserProfile(user);
    },
  };
}
