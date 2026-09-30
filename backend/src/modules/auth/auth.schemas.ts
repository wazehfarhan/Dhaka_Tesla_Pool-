import { z } from 'zod';

/**
 * Input validation at the controller edge — security.md §3: nothing reaches the
 * service unvalidated, and emails are trimmed + lowercased *before* validation so
 * the stored value is exactly the lookup key.
 */
const emailField = z.string().trim().toLowerCase().pipe(z.email());

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: emailField,
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  role: z.enum(['PASSENGER', 'DRIVER']),
});

export const loginSchema = z.object({
  email: emailField,
  // Deliberately only "non-empty": every wrong password — any length — must reach
  // the uniform 401, never a 400 that would reveal the policy during probing.
  password: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
