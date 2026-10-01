import { z } from 'zod';
import { loadDotEnv } from './load-env.js';

/**
 * Single source of truth for configuration — architecture.md §8.
 * Nothing else in the codebase reads `process.env`; modules receive this object.
 * A missing or too-short secret fails the boot loudly rather than at first use.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required — copy .env.example to .env'),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  /**
   * Rate-limit ceilings (security.md §5). Configurable because an operator may
   * want different numbers — and because the concurrency suite fires hundreds
   * of requests on purpose, where being throttled by our own limiter would look
   * exactly like a lost seat race.
   */
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(100),
  RATE_LIMIT_MAX_AUTH: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_MAX_REFRESH: z.coerce.number().int().min(1).default(30),
});

export type Env = z.infer<typeof envSchema>;

/** Validate the environment, loading `.env` first when called with the real `process.env`. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (source === process.env) loadDotEnv();

  const result = envSchema.safeParse(source);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${problems}\n\nFix your .env (see .env.example) and restart.`,
    );
  }

  return result.data;
}
