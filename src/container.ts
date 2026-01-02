import { PrismaClient } from '@prisma/client';
import { getRedisClient, closeRedisConnection, logger } from './infrastructure/index.js';
import { QueueManager } from './core/queue/index.js';
import { JobProcessor } from './core/worker/JobProcessor.js';
import { JobRepository } from './repositories/job.repository.js';
import { WorkerRepository } from './repositories/worker.repository.js';
import { JobService } from './services/job.service.js';

export interface Container {
  prisma: PrismaClient;
  redis: Awaited<ReturnType<typeof getRedisClient>>;
  logger: typeof logger;
  queueManager: QueueManager;
  jobRepository: JobRepository;
  workerRepository: WorkerRepository;
  jobProcessor: JobProcessor;
  jobService: JobService;
}

export async function createContainer(): Promise<Container> {
  const prisma = new PrismaClient();
  const redis = await getRedisClient();
  const queueManager = new QueueManager(redis);
  const jobRepository = new JobRepository(prisma);
  const workerRepository = new WorkerRepository(prisma);
  const jobProcessor = new JobProcessor(jobRepository, queueManager, logger);
  const jobService = new JobService(jobRepository, queueManager);
  logger.info('Container initialized');
  return {
    prisma,
    redis,
    logger,
    queueManager,
    jobRepository,
    workerRepository,
    jobProcessor,
    jobService,
  };
}

export async function destroyContainer(container: Container): Promise<void> {
  await container.prisma.$disconnect();
  await closeRedisConnection();
  container.logger.info('Container destroyed');
}
