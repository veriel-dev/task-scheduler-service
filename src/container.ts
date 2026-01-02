import { PrismaClient } from '@prisma/client';
import { getRedisClient, closeRedisConnection, logger } from './infrastructure/index.js';
import { QueueManager } from './core/queue/index.js';
export interface Container {
  prisma: PrismaClient;
  redis: Awaited<ReturnType<typeof getRedisClient>>;
  logger: typeof logger;
  queueManager: QueueManager;
}

export async function createContainer(): Promise<Container> {
  const prisma = new PrismaClient();
  const redis = await getRedisClient();
  const queueManager = new QueueManager(redis);
  logger.info('Container initialized');
  return {
    prisma,
    redis,
    logger,
    queueManager,
  };
}

export async function destroyContainer(container: Container): Promise<void> {
  await container.prisma.$disconnect();
  await closeRedisConnection();
  container.logger.info('Container destroyed');
}
