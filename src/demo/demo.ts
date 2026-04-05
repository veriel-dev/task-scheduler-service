import 'dotenv/config';
import pino from 'pino';
import { createContainer, destroyContainer } from '../container.js';
import { logger as globalLogger } from '../infrastructure/index.js';
import { Worker } from '../core/worker/index.js';
import { env } from '../config/env.js';
import { DemoEventBus } from './DemoEventBus.js';
import { DemoRenderer } from './DemoRenderer.js';
import { DemoScenario } from './DemoScenario.js';
import { emailHandler } from './handlers/email.handler.js';
import { reportHandler } from './handlers/report.handler.js';
import { imageHandler } from './handlers/image.handler.js';
import type { Job } from '@prisma/client';
import type { JobProcessor, JobResult } from '../core/worker/JobProcessor.js';
import type { QueueManager } from '../core/queue/QueueManager.js';

// Silent logger: writes to /dev/null so it doesn't interfere with the dashboard
const silentLogger = pino({ level: 'silent' });

function patchJobProcessor(processor: JobProcessor, eventBus: DemoEventBus): void {
  const originalProcess = processor.process.bind(processor) as (
    job: Job,
    workerId: string
  ) => Promise<JobResult>;

  processor.process = async (job: Job, workerId: string): Promise<JobResult> => {
    eventBus.push({
      timestamp: new Date(),
      jobId: job.id,
      jobType: job.type,
      status: 'PROCESSING',
      message: `Processing...`,
    });

    const startTime = Date.now();
    const result = await originalProcess(job, workerId);
    const duration = Date.now() - startTime;

    if (result.success) {
      eventBus.push({
        timestamp: new Date(),
        jobId: job.id,
        jobType: job.type,
        status: 'COMPLETED',
        message: `Completed (${(duration / 1000).toFixed(1)}s)`,
        duration,
      });
    } else {
      eventBus.push({
        timestamp: new Date(),
        jobId: job.id,
        jobType: job.type,
        status: 'FAILED',
        message: result.error ?? 'Unknown error',
      });
    }

    return result;
  };
}

function patchQueueManager(queueManager: QueueManager, eventBus: DemoEventBus): void {
  const originalRequeue = queueManager.requeue.bind(queueManager) as (
    jobId: string,
    priority: string,
    delayMs: number
  ) => Promise<void>;

  queueManager.requeue = async (
    jobId: string,
    priority: string,
    delayMs: number
  ): Promise<void> => {
    eventBus.push({
      timestamp: new Date(),
      jobId,
      jobType: '',
      status: 'RETRYING',
      message: `Retry in ${(delayMs / 1000).toFixed(0)}s`,
    });
    return originalRequeue(jobId, priority, delayMs);
  };

  const originalMoveToDLQ = queueManager.moveToDLQ.bind(queueManager) as (
    jobId: string,
    reason: string
  ) => Promise<void>;

  queueManager.moveToDLQ = async (jobId: string, reason: string): Promise<void> => {
    eventBus.push({
      timestamp: new Date(),
      jobId,
      jobType: '',
      status: 'DLQ',
      message: 'Max retries exceeded',
    });
    return originalMoveToDLQ(jobId, reason);
  };
}

async function main(): Promise<void> {
  // Silence global logger used by QueueManager (imported directly, not injected)
  globalLogger.level = 'silent';

  const container = await createContainer(silentLogger);
  const eventBus = new DemoEventBus();

  // Register realistic handlers
  container.jobProcessor.registerHandler('email.send', emailHandler);
  container.jobProcessor.registerHandler('report.generate', reportHandler);
  container.jobProcessor.registerHandler('image.resize', imageHandler);

  // Monkey-patch to capture events without modifying production code
  patchJobProcessor(container.jobProcessor, eventBus);
  patchQueueManager(container.queueManager, eventBus);

  // Create worker
  const worker = new Worker(
    container.jobRepository,
    container.workerRepository,
    container.queueManager,
    container.jobProcessor,
    silentLogger,
    {
      name: `demo-worker-${String(process.pid)}`,
      concurrency: env.WORKER_CONCURRENCY,
      pollIntervalMs: 500,
      heartbeatIntervalMs: 15000,
      promoteIntervalMs: 2000,
    }
  );

  // Create renderer and scenario
  const renderer = new DemoRenderer(container.metricsService, eventBus);
  const scenario = new DemoScenario(container.jobService, container.scheduleService, eventBus);

  // Ensure cursor is always restored on exit
  process.on('exit', () => {
    process.stdout.write('\x1b[?25h');
  });

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    renderer.stop();
    scenario.stop();
    await worker.stop();
    await container.scheduleExecutor.stop();
    container.orphanJobRecovery.stop();
    await destroyContainer(container);
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  // Start everything
  container.orphanJobRecovery.start();
  await container.scheduleExecutor.start();
  renderer.start();
  scenario.start();

  // Worker loop runs until stopped (event loop stays alive for timers)
  void worker.start();
}

main().catch((error: unknown) => {
  process.stdout.write('\x1b[?25h');
  console.error('Failed to start demo:', error);
  process.exit(1);
});
