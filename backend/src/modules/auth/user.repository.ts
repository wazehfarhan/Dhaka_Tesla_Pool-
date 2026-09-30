import type { PrismaClient, Role } from '../../generated/prisma/client.js';

export interface CreateUserInput {
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
}

/**
 * Prisma-only access to `users` — architecture.md §4: repositories issue typed
 * queries and never make business decisions (uniqueness is settled by the unique
 * index; the service maps its violation to EMAIL_TAKEN).
 */
export function createUserRepository(prisma: PrismaClient) {
  return {
    async findByEmail(email: string) {
      return prisma.user.findUnique({ where: { email } });
    },

    async findById(id: string) {
      return prisma.user.findUnique({ where: { id } });
    },

    async create(input: CreateUserInput) {
      return prisma.user.create({ data: input });
    },
  };
}
