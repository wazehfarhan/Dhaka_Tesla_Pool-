import type { Role } from '../../generated/prisma/client.js';

/**
 * The public shape of a user — every response serialises this and only this.
 * `passwordHash` is deliberately absent; nothing here can leak it (api.md §2).
 */
export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: Role;
}

/** Explicit field pick: new columns on `users` never appear in responses by accident. */
export function toUserProfile(user: {
  id: string;
  name: string;
  email: string;
  role: Role;
}): UserProfile {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}
