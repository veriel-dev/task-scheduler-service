import { PrismaClient } from '@prisma/client';
import { getRedisClient, closeRedisConnection, logger } from './infrastructure/index.js';

export interface Container {
  prisma: PrismaClient;
  redis: Awaited<ReturnType<typeof getRedisClient>>;
  logger: typeof logger;
}

export async function createContainer(): Promise<Container> {
  const prisma = new PrismaClient();
  const redis = await getRedisClient();
  logger.info('Container initialized');
  return {
    prisma,
    redis,
    logger,
  };
}

export async function destroyContainer(container: Container): Promise<void> {
  await container.prisma.$disconnect();
  await closeRedisConnection();
  container.logger.info('Container destroyed');
}
