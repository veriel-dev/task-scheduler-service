import type { Logger } from '../../infrastructure/index.js';
import type { JobRepository } from '../../repositories/job.repository.js';
import type { WorkerRepository } from '../../repositories/worker.repository.js';
import type { QueueManager } from '../queue/QueueManager.js';

export interface OrphanJobRecoveryConfig {
  checkIntervalMs: number; // Intervalo entre chequeos (default: 60s)
  staleThresholdMs: number; // Tiempo sin heartbeat para considerar worker muerto (default: 90s)
  recoveryDelayMs: number; // Delay antes de reencolar job huérfano (default: 5s)
}

const DEFAULT_CONFIG: OrphanJobRecoveryConfig = {
  checkIntervalMs: 60000, // 1 minuto
  staleThresholdMs: 90000, // 90 segundos
  recoveryDelayMs: 5000, // 5 segundos
};

export class OrphanJobRecovery {
  private config: OrphanJobRecoveryConfig;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly workerRepository: WorkerRepository,
    private readonly queueManager: QueueManager,
    private readonly logger: Logger,
    config?: Partial<OrphanJobRecoveryConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Inicia el proceso de recuperación periódica
   */
  start(): void {
    if (this.running) {
      this.logger.warn('OrphanJobRecovery already running');
      return;
    }

    this.running = true;
    this.logger.info(
      {
        checkIntervalMs: this.config.checkIntervalMs,
        staleThresholdMs: this.config.staleThresholdMs,
      },
      'OrphanJobRecovery started'
    );

    // Ejecutar inmediatamente y luego periódicamente
    void this.recover();

    this.timer = setInterval(() => {
      void this.recover();
    }, this.config.checkIntervalMs);
  }

  /**
   * Detiene el proceso de recuperación
   */
  stop(): void {
    if (!this.running) return;

    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.logger.info('OrphanJobRecovery stopped');
  }

  /**
   * Ejecuta un ciclo de recuperación
   */
  async recover(): Promise<{ staleWorkers: number; orphanJobs: number }> {
    try {
      // 1. Encontrar workers stale (sin heartbeat reciente)
      const staleWorkers = await this.workerRepository.findStaleWorkers(
        this.config.staleThresholdMs
      );

      if (staleWorkers.length === 0) {
        return { staleWorkers: 0, orphanJobs: 0 };
      }

      this.logger.warn(
        { count: staleWorkers.length, workerIds: staleWorkers.map((w) => w.id) },
        'Found stale workers'
      );

      let orphanJobsRecovered = 0;

      // 2. Para cada worker stale, recuperar sus jobs
      for (const worker of staleWorkers) {
        const recoveredCount = await this.recoverWorkerJobs(worker.id);
        orphanJobsRecovered += recoveredCount;

        // 3. Marcar worker como stopped
        await this.workerRepository.stop(worker.id);
        this.logger.info({ workerId: worker.id }, 'Stale worker marked as stopped');
      }

      if (orphanJobsRecovered > 0) {
        this.logger.info({ count: orphanJobsRecovered }, 'Orphan jobs recovered');
      }

      return { staleWorkers: staleWorkers.length, orphanJobs: orphanJobsRecovered };
    } catch (error) {
      this.logger.error({ error }, 'Error in orphan job recovery');
      return { staleWorkers: 0, orphanJobs: 0 };
    }
  }

  /**
   * Recupera los jobs de un worker específico
   */
  private async recoverWorkerJobs(workerId: string): Promise<number> {
    // Buscar jobs en PROCESSING asignados a este worker
    const orphanJobs = await this.findOrphanJobs(workerId);

    if (orphanJobs.length === 0) {
      return 0;
    }

    this.logger.warn(
      { workerId, jobIds: orphanJobs.map((j) => j.id) },
      'Found orphan jobs from stale worker'
    );

    // Recuperar cada job
    for (const job of orphanJobs) {
      await this.recoverJob(job.id, job.priority, job.retryCount);
    }

    return orphanJobs.length;
  }

  /**
   * Encuentra jobs huérfanos de un worker
   */
  private async findOrphanJobs(
    workerId: string
  ): Promise<Array<{ id: string; priority: string; retryCount: number }>> {
    // Usamos una query directa ya que necesitamos filtrar por workerId
    const result = await this.jobRepository.findMany({
      page: 1,
      limit: 100, // Límite razonable por worker
      status: 'PROCESSING',
    });

    // Filtrar por workerId (el repositorio no soporta este filtro directamente)
    return result.data
      .filter((job) => job.workerId === workerId)
      .map((job) => ({
        id: job.id,
        priority: job.priority,
        retryCount: job.retryCount,
      }));
  }

  /**
   * Recupera un job individual: lo marca como RETRYING y lo reencola
   */
  private async recoverJob(
    jobId: string,
    priority: string,
    currentRetryCount: number
  ): Promise<void> {
    // Actualizar estado a RETRYING
    await this.jobRepository.update(jobId, {
      status: 'RETRYING',
      retryCount: currentRetryCount + 1,
      error: 'Worker died - job recovered automatically',
      workerId: null,
    });

    // Limpiar de la cola de processing en Redis
    await this.queueManager.markCompleted(jobId);

    // Reencolar con un pequeño delay para evitar loops
    await this.queueManager.requeue(
      jobId,
      priority as 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW',
      this.config.recoveryDelayMs
    );

    this.logger.info({ jobId }, 'Orphan job recovered and requeued');
  }
}
