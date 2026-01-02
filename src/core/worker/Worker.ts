import type { Job } from '@prisma/client';
import type { Logger } from '../../infrastructure/index.js';
import type { JobRepository } from '../../repositories/job.repository.js';
import type { WorkerRepository } from '../../repositories/worker.repository.js';
import type { QueueManager } from '../queue/QueueManager.js';
import type { JobProcessor } from './JobProcessor.js';

export interface WorkerConfig {
  name: string;
  concurrency: number; // Jobs en paralelo (para futuro ahora será 1)
  pollIntervalMs: number; // Intervalo de polling cuando no hay jobs
  heartbeatIntervalMs: number; // Intervalo de heartbeat
  promoteIntervalMs: number; // Intervalo para promover delayed jobs
}

const DEFAULT_CONFIG: WorkerConfig = {
  name: 'worker',
  concurrency: 1,
  pollIntervalMs: 1000, // 1 segundo
  heartbeatIntervalMs: 30000, // 30 segundos
  promoteIntervalMs: 5000, // 5 segundos
};

export class Worker {
  private config: WorkerConfig;
  private workerId: string | null = null;
  private running = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private promoteTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly workerRepository: WorkerRepository,
    private readonly queueManager: QueueManager,
    private readonly jobProcessor: JobProcessor,
    private readonly logger: Logger,
    config?: Partial<WorkerConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  /**
   * Inicia el worker: registra, inicia timers, y comienza el loop
   */
  async start(): Promise<void> {
    if (this.running) {
      this.logger.warn('Worker already running');
      return;
    }

    // Registrar worker en PostgreSQL
    const worker = await this.workerRepository.register({
      name: this.config.name,
      concurrency: this.config.concurrency,
      pid: process.pid,
    });
    this.workerId = worker.id;

    this.running = true;
    this.logger.info({ workerId: this.workerId, pid: process.pid }, 'Worker started');

    // Iniciar heartbeat periódico
    this.startHeartbeat();

    // Iniciar promoción de delayed jobs
    this.startDelayedPromoter();

    // Registrar handlers de señales para shutdown graceful
    this.registerSignalHandlers();

    // Iniciar loop principal
    await this.loop();
  }
  /**
   * Detiene el worker de forma graceful
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.logger.info({ workerId: this.workerId }, 'Worker stopping...');
    this.running = false;

    // Detener timers
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.promoteTimer) {
      clearInterval(this.promoteTimer);
      this.promoteTimer = null;
    }

    // Marcar como stopped en PostgreSQL
    if (this.workerId) {
      await this.workerRepository.stop(this.workerId);
    }

    this.logger.info({ workerId: this.workerId }, 'Worker stopped');
  }
  /**
   * Loop principal: consume jobs de la cola
   */
  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const jobId = await this.queueManager.dequeue();

        if (!jobId) {
          // No hay jobs, esperar antes de reintentar
          await this.sleep(this.config.pollIntervalMs);
          continue;
        }

        // Obtener job de PostgreSQL
        const job = await this.jobRepository.findById(jobId);

        if (!job) {
          this.logger.warn({ jobId }, 'Job not found in database');
          continue;
        }

        // Verificar que el job está en estado válido para procesar
        if (!this.isProcessableStatus(job.status)) {
          this.logger.warn({ jobId, status: job.status }, 'Job not in processable status');
          continue;
        }

        // Procesar el job
        await this.processJob(job);
      } catch (error) {
        this.logger.error({ error }, 'Error in worker loop');
        await this.sleep(this.config.pollIntervalMs);
      }
    }
  }
  /**
   * Procesa un job individual
   */
  private async processJob(job: Job): Promise<void> {
    if (!this.workerId) return;

    // Actualizar contador de jobs activos
    await this.workerRepository.setActiveJobs(this.workerId, 1);

    try {
      const result = await this.jobProcessor.process(job, this.workerId);

      // Actualizar estadísticas
      if (result.success) {
        await this.workerRepository.incrementProcessed(this.workerId);
      } else {
        await this.workerRepository.incrementFailed(this.workerId);
      }
    } finally {
      await this.workerRepository.setActiveJobs(this.workerId, 0);
    }
  }
  /**
   * Verifica si un job está en estado procesable
   */
  private isProcessableStatus(status: string): boolean {
    return ['QUEUED', 'RETRYING'].includes(status);
  }
  /**
   * Inicia el heartbeat periódico
   */
  private startHeartbeat(): void {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.heartbeatTimer = setInterval(async () => {
      if (this.workerId) {
        try {
          await this.workerRepository.updateHeartbeat(this.workerId);
          this.logger.debug({ workerId: this.workerId }, 'Heartbeat sent');
        } catch (error) {
          this.logger.error({ error }, 'Failed to send heartbeat');
        }
      }
    }, this.config.heartbeatIntervalMs);
  }
  /**
   * Inicia el promotor de delayed jobs
   */
  private startDelayedPromoter(): void {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.promoteTimer = setInterval(async () => {
      try {
        const promoted = await this.queueManager.promoteDelayedJobs();
        if (promoted > 0) {
          this.logger.debug({ count: promoted }, 'Promoted delayed jobs');
        }
      } catch (error) {
        this.logger.error({ error }, 'Failed to promote delayed jobs');
      }
    }, this.config.promoteIntervalMs);
  }
  /**
   * Registra handlers para señales del sistema
   */
  private registerSignalHandlers(): void {
    const shutdown = async (signal: string) => {
      this.logger.info({ signal }, 'Received shutdown signal');
      await this.stop();
      process.exit(0);
    };

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
  }
  /**
   * Helper para sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
