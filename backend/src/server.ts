import { createApp } from './app.js';
import { loadEnv, type Env } from './config/env.js';
import { createDatabase } from './db/client.js';
import { createLogger } from './shared/logger.js';

/**
 * Bootstrap: validate configuration, build the app, listen, shut down cleanly.
 * The only place allowed to read the environment (architecture.md §8).
 */
function bootstrap(): void {
  let env: Env;

  try {
    env = loadEnv();
  } catch (error) {
    // Before the logger exists, so this is the one sanctioned direct write.
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }

  const logger = createLogger(env);
  const database = createDatabase(env.DATABASE_URL);
  const app = createApp({ env, logger, database });

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, 'Dhaka Tesla Pool API listening');
  });

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      logger.info({ signal }, 'Shutting down');
      server.close(async (error) => {
        await database
          .close()
          .catch((err: unknown) => logger.error({ err }, 'Error closing database'));
        if (error) {
          logger.error({ err: error }, 'Graceful shutdown failed');
          process.exit(1);
        }
        process.exit(0);
      });
    });
  }
}

bootstrap();
