import type { RequestHandler } from 'express';
import type { TokenService } from '../modules/auth/token.service.js';
import type { Role } from '../generated/prisma/client.js';
import { ForbiddenError, UnauthenticatedError } from '../shared/errors.js';

/** The verified caller attached to every authenticated request — security.md §2. */
export interface AuthUser {
  id: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- required: merging with Express's global type namespace
  namespace Express {
    interface Request {
      /** Set by `authenticate`. Ownership checks stay in services (architecture.md §3). */
      user?: AuthUser;
    }
  }
}

export interface AuthMiddleware {
  authenticate: RequestHandler;
  authorize: (...roles: Role[]) => RequestHandler;
}

/**
 * JWT verification and role gates — architecture.md §3. This layer never does
 * ownership checks (that is the service's job) and never touches the database:
 * the access token is stateless by design (security.md §1).
 */
export function createAuthMiddleware(tokens: TokenService): AuthMiddleware {
  const authenticate: RequestHandler = (req, _res, next) => {
    const header = req.headers.authorization;
    const match = header === undefined ? null : /^Bearer\s+(\S+)$/i.exec(header);
    if (!match) {
      next(new UnauthenticatedError('A Bearer access token is required.'));
      return;
    }

    const token = match[1];
    if (!token) {
      next(new UnauthenticatedError('A Bearer access token is required.'));
      return;
    }

    try {
      const payload = tokens.verifyAccessToken(token); // throws 401 on forged/expired/wrong-type
      req.user = { id: payload.sub, role: payload.role };
      next();
    } catch (error) {
      next(error);
    }
  };

  /**
   * Role gate for endpoint *classes* (passenger → /driver/*) → 403 per api.md §1.
   * Resource ownership is deliberately not handled here.
   */
  const authorize =
    (...roles: Role[]): RequestHandler =>
    (req, _res, next) => {
      if (!req.user) {
        next(new UnauthenticatedError('A Bearer access token is required.'));
        return;
      }
      if (!roles.includes(req.user.role)) {
        next(new ForbiddenError());
        return;
      }
      next();
    };

  return { authenticate, authorize };
}
