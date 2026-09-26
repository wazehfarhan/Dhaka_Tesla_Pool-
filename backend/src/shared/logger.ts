import { pino, type Logger } from 'pino';
import type { Env } from '../config/env.js';

export type AppLogger = Logger;

/**
 * Structured logging — architecture.md §8.
 * JSON in test/production (pipe through `pino-pretty` if you want it human-shaped),
 * pretty output only in local development where the devDependency exists.
 */
export function createLogger(env: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>): AppLogger {
  return pino({
    level: env.LOG_LEVEL,
    // Request ids carry the context; pid/hostname noise is dropped.
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    transport:
      env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } }
        : undefined,
  });
}
