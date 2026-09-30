import { createHash, randomUUID } from 'node:crypto';
import { compare, hash } from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Env } from '../../config/env.js';
import type { Role } from '../../generated/prisma/client.js';
import { UnauthenticatedError } from '../../shared/errors.js';
import { ACCESS_TOKEN_TTL, BCRYPT_COST, REFRESH_TOKEN_TTL } from './auth.constants.js';

/**
 * Password hashing and JWT issue/verify — security.md §1.
 *
 * The `type` claim is an extra discriminator beyond the documented payloads: it
 * stops a refresh token from ever being replayed as an access token (or vice
 * versa) even though both are HS-signed by this module.
 */
export interface AccessTokenPayload {
  sub: string;
  role: Role;
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  type: 'refresh';
}

export interface TokenService {
  hashPassword(password: string): Promise<string>;
  verifyPassword(password: string, passwordHash: string): Promise<boolean>;
  signAccessToken(input: { sub: string; role: Role }): string;
  /** Throws `UnauthenticatedError` for forged, expired or wrong-type tokens. */
  verifyAccessToken(token: string): AccessTokenPayload;
  /** Returns the raw token plus the `jti` to persist — the raw token is never stored. */
  signRefreshToken(sub: string): { token: string; jti: string };
  verifyRefreshToken(token: string): RefreshTokenPayload;
  /** SHA-256 of a `jti` — what actually lands in `refresh_tokens.jti_hash` (schema). */
  hashTokenId(jti: string): string;
}

export function createTokenService(
  env: Pick<Env, 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET'>,
): TokenService {
  const invalid = (): UnauthenticatedError => new UnauthenticatedError('Invalid or expired token.');

  /** Verify signature + expected `type` in one place; claim shape is checked by each caller. */
  function readClaims(token: string, secret: string, expectedType: 'access' | 'refresh') {
    let decoded: unknown;
    try {
      decoded = jwt.verify(token, secret);
    } catch {
      throw invalid();
    }
    if (typeof decoded !== 'object' || decoded === null) throw invalid();
    const claims = decoded as Record<string, unknown>;
    if (claims.type !== expectedType) throw invalid();
    return claims;
  }

  return {
    async hashPassword(password: string): Promise<string> {
      return hash(password, BCRYPT_COST);
    },

    async verifyPassword(password: string, passwordHash: string): Promise<boolean> {
      return compare(password, passwordHash);
    },

    signAccessToken({ sub, role }): string {
      return jwt.sign({ sub, role, type: 'access' }, env.JWT_ACCESS_SECRET, {
        expiresIn: ACCESS_TOKEN_TTL,
      });
    },

    verifyAccessToken(token: string): AccessTokenPayload {
      const claims = readClaims(token, env.JWT_ACCESS_SECRET, 'access');
      if (typeof claims.sub !== 'string') throw invalid();
      const role = claims.role;
      if (role !== 'PASSENGER' && role !== 'DRIVER') throw invalid();
      return { sub: claims.sub, role, type: 'access' };
    },

    signRefreshToken(sub: string): { token: string; jti: string } {
      const jti = randomUUID();
      const token = jwt.sign({ sub, jti, type: 'refresh' }, env.JWT_REFRESH_SECRET, {
        expiresIn: REFRESH_TOKEN_TTL,
      });
      return { token, jti };
    },

    verifyRefreshToken(token: string): RefreshTokenPayload {
      const claims = readClaims(token, env.JWT_REFRESH_SECRET, 'refresh');
      if (typeof claims.sub !== 'string' || typeof claims.jti !== 'string') throw invalid();
      return { sub: claims.sub, jti: claims.jti, type: 'refresh' };
    },

    hashTokenId(jti: string): string {
      return createHash('sha256').update(jti).digest('hex');
    },
  };
}
