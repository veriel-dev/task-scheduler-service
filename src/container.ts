import { PrismaClient } from '@prisma/client';
import { getRedisClient, closeRedisConnection, logger } from './infrastructure/index.js';
import { QueueManager } from './core/queue/index.js';
import { JobProcessor } from './core/worker/JobProcessor.js';
import { OrphanJobRecovery } from './core/worker/OrphanJobRecovery.js';
import { WebhookDispatcher, WebhookRetryProcessor } from './core/webhook/index.js';
import { ScheduleExecutor } from './core/scheduler/index.js';
import { JobRepository } from './repositories/job.repository.js';
import { WorkerRepository } from './repositories/worker.repository.js';
import { ScheduleRepository } from './repositories/schedule.repository.js';
import { DeadLetterRepository } from './repositories/dead-letter.repository.js';
import { WebhookEventRepository } from './repositories/webhook-event.repository.js';
import { JobService } from './services/job.service.js';
import { ScheduleService } from './services/schedule.service.js';
import { DeadLetterService } from './services/dead-letter.service.js';
import { MetricsService } from './services/metrics.service.js';
import { env } from './config/env.js';

export interface Container {
  prisma: PrismaClient;
  redis: Awaited<ReturnType<typeof getRedisClient>>;
  logger: typeof logger;
  queueManager: QueueManager;
  jobRepository: JobRepository;
  workerRepository: WorkerRepository;
  scheduleRepository: ScheduleRepository;
  deadLetterRepository: DeadLetterRepository;
  webhookEventRepository: WebhookEventRepository;
  jobProcessor: JobProcessor;
  orphanJobRecovery: OrphanJobRecovery;
  webhookDispatcher: WebhookDispatcher;
  webhookRetryProcessor: WebhookRetryProcessor;
  scheduleExecutor: ScheduleExecutor;
  jobService: JobService;
  scheduleService: ScheduleService;
  deadLetterService: DeadLetterService;
  metricsService: MetricsService;
}

export async function createContainer(): Promise<Container> {
  const prisma = new PrismaClient();
  const redis = await getRedisClient();
  const queueManager = new QueueManager(redis);

  // Repositories
  const jobRepository = new JobRepository(prisma);
  const workerRepository = new WorkerRepository(prisma);
  const scheduleRepository = new ScheduleRepository(prisma);
  const deadLetterRepository = new DeadLetterRepository(prisma);
  const webhookEventRepository = new WebhookEventRepository(prisma);

  // Webhook components
  const webhookDispatcher = new WebhookDispatcher(webhookEventRepository, logger, {
    timeoutMs: env.WEBHOOK_TIMEOUT_MS,
    maxAttempts: env.WEBHOOK_MAX_ATTEMPTS,
  });
  const webhookRetryProcessor = new WebhookRetryProcessor(
    webhookEventRepository,
    webhookDispatcher,
    logger,
    {
      checkIntervalMs: env.WEBHOOK_RETRY_INTERVAL_MS,
      baseDelayMs: env.WEBHOOK_RETRY_BASE_DELAY_MS,
    }
  );

  // Processors
  const jobProcessor = new JobProcessor(
    jobRepository,
    queueManager,
    logger,
    undefined, // retryConfig - usar defaults
    deadLetterRepository,
    webhookDispatcher
  );
  const orphanJobRecovery = new OrphanJobRecovery(
    jobRepository,
    workerRepository,
    queueManager,
    logger,
    {
      checkIntervalMs: env.ORPHAN_CHECK_INTERVAL_MS,
      staleThresholdMs: env.ORPHAN_STALE_THRESHOLD_MS,
      recoveryDelayMs: env.ORPHAN_RECOVERY_DELAY_MS,
    }
  );
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
  const deadLetterService = new DeadLetterService(deadLetterRepository, jobRepository, queueManager);
  const metricsService = new MetricsService(prisma, redis, queueManager);

  logger.info('Container initialized');

  return {
    prisma,
    redis,
    logger,
    queueManager,
    jobRepository,
    workerRepository,
    scheduleRepository,
    deadLetterRepository,
    webhookEventRepository,
    jobProcessor,
    orphanJobRecovery,
    webhookDispatcher,
    webhookRetryProcessor,
    scheduleExecutor,
    jobService,
    scheduleService,
    deadLetterService,
    metricsService,
  };
}

export async function destroyContainer(container: Container): Promise<void> {
  await container.prisma.$disconnect();
  await closeRedisConnection();
  container.logger.info('Container destroyed');
}
