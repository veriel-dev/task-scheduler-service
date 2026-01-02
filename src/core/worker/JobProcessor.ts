import type { Job } from '@prisma/client';
import type { JobRepository } from '../../repositories/job.repository.js';
import type { QueueManager } from '../queue/QueueManager.js';
import type { Logger } from '../../infrastructure/index.js';

// Función que procesa un job específico
export type JobHandler = (job: Job) => Promise<unknown>;

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number; // Delay inicial en ms
  maxDelay: number; // Delay máximo en ms
  multiplier: number; // Factor de multiplicación
}
export interface JobResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 60000,
  multiplier: 2,
};
export class JobProcessor {
  private handlers: Map<string, JobHandler> = new Map();
  private retryConfig: RetryConfig;

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly queueManager: QueueManager,
    private readonly logger: Logger,
    retryConfig?: Partial<RetryConfig>
  ) {
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }
  /**
   * Registra un handler para un tipo de job
   * Ejemplo: processor.registerHandler('email.send', async (job) => { ... })
   */
  registerHandler(jobType: string, handler: JobHandler): void {
    this.handlers.set(jobType, handler);
    this.logger.info({ jobType }, 'Job handler registered');
  }
  /**
   * Calcula el delay con backoff exponencial: baseDelay * multiplier^retryCount
   * Ejemplo con defaults: 1000 * 2^0 = 2s, 1000 *2^2 = 4s
   */
  private calculateRetryDelay(retryCount: number, baseDelay: number): number {
    const delay = baseDelay * Math.pow(this.retryConfig.multiplier, retryCount);
    return Math.min(delay, this.retryConfig.maxDelay);
  }
  /**
   * Proceso un job completo con manejo de estados
   */
  async process(job: Job, workerId: string): Promise<JobResult> {
    const handler = this.handlers.get(job.type);

    if (!handler) {
      this.logger.error({ jobId: job.id, jobType: job.type }, 'No handler for job type');
      await this.handleFailure(job, `No handler registered for job type: ${job.type}`);
      return { success: false, error: `No handler for type: ${job.type}` };
    }
    // Transición: QUEUED -> PROCESSING
    await this.jobRepository.update(job.id, {
      status: 'PROCESSING',
      startedAt: new Date(),
      workerId,
    });
    await this.queueManager.markProcessing(job.id, workerId);
    this.logger.info({ jobId: job.id, jobType: job.type }, 'Processing Job');

    try {
      const result = await handler(job);
      await this.handleSuccess(job, result);
      return { success: true, result };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.handleError(job, errorMessage);
      return { success: false, error: errorMessage };
    }
  }
  /**
   * Job completado exitosamente -> COMPLETED
   */
  private async handleSuccess(job: Job, result: unknown): Promise<void> {
    await this.jobRepository.update(job.id, {
      status: 'COMPLETED',
      result: result as object,
      completedAt: new Date(),
    });
    await this.queueManager.markCompleted(job.id);

    this.logger.info({ jobId: job.id, jobType: job.type }, 'Job completed');

    if (job.webhookUrl) {
      await this.triggerWebhook(job, 'completed', result);
    }
  }
  /**
   * Error en ejecución → decidir si reintentar o fallar
   */
  private async handleError(job: Job, errorMessage: string): Promise<void> {
    const maxRetries = job.maxRetries;
    const currentRetry = job.retryCount;

    this.logger.warn(
      { jobId: job.id, error: errorMessage, retryCount: currentRetry, maxRetries },
      'Job failed'
    );

    if (currentRetry < maxRetries) {
      await this.scheduleRetry(job, currentRetry + 1, errorMessage);
    } else {
      await this.handleFailure(job, errorMessage);
    }
  }
  /**
   * Programar reintento con backoff exponencial
   */
  private async scheduleRetry(job: Job, retryCount: number, errorMessage: string): Promise<void> {
    const baseDelay = job.retryDelay;
    const delay = this.calculateRetryDelay(retryCount - 1, baseDelay);

    await this.jobRepository.update(job.id, {
      status: 'RETRYING',
      retryCount,
      error: errorMessage,
    });

    // Requeue usa la delayed queue internamente
    await this.queueManager.requeue(job.id, job.priority, delay);

    this.logger.info({ jobId: job.id, retryCount, delayMs: delay }, 'Job scheduled for retry');
  }
  /**
   * Fallo definitivo → FAILED + DLQ
   */
  private async handleFailure(job: Job, errorMessage: string): Promise<void> {
    await this.jobRepository.update(job.id, {
      status: 'FAILED',
      error: errorMessage,
      completedAt: new Date(),
    });

    await this.queueManager.moveToDLQ(job.id, errorMessage);

    this.logger.error({ jobId: job.id, error: errorMessage }, 'Job failed permanently');

    if (job.webhookUrl) {
      await this.triggerWebhook(job, 'failed', null, errorMessage);
    }
  }
  /**
   * Notificar via webhook (fire and forget, no bloquea)
   */
  private async triggerWebhook(
    job: Job,
    status: 'completed' | 'failed',
    result?: unknown,
    error?: string
  ): Promise<void> {
    if (!job.webhookUrl) return;

    try {
      const response = await fetch(job.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: job.id,
          jobType: job.type,
          status,
          result,
          error,
          completedAt: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        this.logger.warn({ jobId: job.id, status: response.status }, 'Webhook failed');
      }
    } catch (err) {
      this.logger.warn({ jobId: job.id, error: err }, 'Webhook error');
    }
  }
}
