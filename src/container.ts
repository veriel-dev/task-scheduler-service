import { PrismaClient } from '@prisma/client';
import { getRedisClient, closeRedisConnection, logger } from './infrastructure/index.js';
import { QueueManager } from './core/queue/index.js';
import { JobProcessor } from './core/worker/JobProcessor.js';
import { ScheduleExecutor } from './core/scheduler/index.js';
import { JobRepository } from './repositories/job.repository.js';
import { WorkerRepository } from './repositories/worker.repository.js';
import { ScheduleRepository } from './repositories/schedule.repository.js';
import { JobService } from './services/job.service.js';
import { ScheduleService } from './services/schedule.service.js';
import { env } from './config/env.js';

export interface Container {
  prisma: PrismaClient;
  redis: Awaited<ReturnType<typeof getRedisClient>>;
  logger: typeof logger;
  queueManager: QueueManager;
  jobRepository: JobRepository;
  workerRepository: WorkerRepository;
  scheduleRepository: ScheduleRepository;
  jobProcessor: JobProcessor;
  scheduleExecutor: ScheduleExecutor;
  jobService: JobService;
  scheduleService: ScheduleService;
}

export async function createContainer(): Promise<Container> {
  const prisma = new PrismaClient();
  const redis = await getRedisClient();
  const queueManager = new QueueManager(redis);

  // Repositories
  const jobRepository = new JobRepository(prisma);
  const workerRepository = new WorkerRepository(prisma);
  const scheduleRepository = new ScheduleRepository(prisma);

  // Processors
  const jobProcessor = new JobProcessor(jobRepository, queueManager, logger);
  const scheduleExecutor = new ScheduleExecutor(
    scheduleRepository,
    jobRepository,
    queueManager,
    logger,
    { checkIntervalMs: env.SCHEDULER_CHECK_INTERVAL_MS }
  );

  // Services
  const jobService = new JobService(jobRepository, queueManager);
  const scheduleService = new ScheduleService(scheduleRepository, jobRepository, queueManager);

  logger.info('Container initialized');

  return {
    prisma,
    redis,
    logger,
    queueManager,
    jobRepository,
    workerRepository,
    scheduleRepository,
    jobProcessor,
    scheduleExecutor,
    jobService,
    scheduleService,
  };
}

export async function destroyContainer(container: Container): Promise<void> {
  await container.prisma.$disconnect();
  await closeRedisConnection();
  container.logger.info('Container destroyed');
}
