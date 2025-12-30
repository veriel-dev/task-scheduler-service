import 'dotenv/config';
import { env } from './config/env.js';
import {
  getPrismaClient,
  logger,
  disconnectPrisma,
  getRedisClient,
  closeRedisConnection,
} from './infrastructure/index.js';
import { createServer } from './api/server.js';

async function bootstrap(): Promise<void> {
  try {
    // Inicializar conexiones
    getPrismaClient();
    await getRedisClient();

    // Crear y levantar servidor
    const app = createServer();
    app.listen(env.PORT, env.HOST, () => {
      logger.info(`Server running on http://${env.HOST}:${String(env.PORT)}`);
      logger.info(`Environment: ${env.NODE_ENV}`);
    });

    // Graceful shutdown
    const shutdown = (signal: string) => {
      logger.info(`${signal} received, shutting down...`);
      Promise.all([disconnectPrisma(), closeRedisConnection()])
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    };

    process.on('SIGTERM', () => {
      shutdown('SIGTERM');
    });
    process.on('SIGINT', () => {
      shutdown('SIGINT');
    });
  } catch (error) {
    logger.error(error, 'Failed to start server');
    process.exit(1);
  }
}

await bootstrap();
