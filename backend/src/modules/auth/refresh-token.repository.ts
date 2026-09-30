import type { PrismaClient } from '../../generated/prisma/client.js';

export interface CreateRefreshTokenInput {
  userId: string;
  jtiHash: string;
  expiresAt: Date;
}

/**
 * The revocation store — `refresh_tokens` is the only stateful part of auth
 * (security.md §1). Only the SHA-256 of each `jti` is ever written; the raw
 * refresh token lives exclusively in the client's cookie.
 */
export function createRefreshTokenRepository(prisma: PrismaClient) {
  return {
    async findByJtiHash(jtiHash: string) {
      return prisma.refreshToken.findUnique({ where: { jtiHash } });
    },

    async create(input: CreateRefreshTokenInput) {
      return prisma.refreshToken.create({ data: input });
    },

    /**
     * Rotation — one transaction: mark the presented row rotated and issue the
     * next. A replay then fails the `rotatedAt` check server-side (security.md §1).
     */
    async rotate(oldId: string, next: CreateRefreshTokenInput): Promise<void> {
      await prisma.$transaction([
        prisma.refreshToken.update({ where: { id: oldId }, data: { rotatedAt: new Date() } }),
        prisma.refreshToken.create({ data: next }),
      ]);
    },

    async revoke(id: string): Promise<void> {
      await prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
    },
  };
}
