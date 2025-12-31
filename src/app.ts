import 'dotenv/config';
import { env } from './config/env.js';
import { logger } from './infrastructure/index.js';
import { createServer } from './api/server.js';
import { createContainer, destroyContainer, type Container } from './container.js';

async function bootstrap(): Promise<void> {
  let container: Container | null = null;
  try {
    // Crear container con todas las dependencias
    container = await createContainer();

    // Crear y levantar servidor
    const app = createServer(container);
    app.listen(env.PORT, env.HOST, () => {
      logger.info(`Server running on http://${env.HOST}:${String(env.PORT)}`);
      logger.info(`Environment: ${env.NODE_ENV}`);
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received, shutting down...`);
      if (container) {
        await destroyContainer(container);
      }
      process.exit(0);
    };

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
  } catch (error) {
    logger.error(error, 'Failed to start server');
    process.exit(1);
  }
}

await bootstrap();
