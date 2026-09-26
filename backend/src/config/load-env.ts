import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Dependency-free `.env` loader (we deliberately avoid dotenv — see tech-stack.md §11).
 *
 * Lookup order, first file found wins:
 *   1. <repo-root>/.env      — canonical location documented in security.md §6
 *   2. <backend>/.env        — convenience when running the API from its own folder
 *
 * Variables already present in `process.env` are never overwritten, so Docker Compose,
 * CI and the hosting platform always take precedence over a local file.
 */
export function loadDotEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url)); // backend/src/config
  const candidates = [resolve(here, '../../../.env'), resolve(here, '../../.env')];

  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;

      const separator = trimmed.indexOf('=');
      if (separator <= 0) continue;

      const key = trimmed.slice(0, separator).trim();
      const rawValue = trimmed.slice(separator + 1).trim();
      const value = rawValue.replace(/^(['"])(.*)\1$/, '$2');

      if (process.env[key] === undefined) process.env[key] = value;
    }
    return;
  }
}
