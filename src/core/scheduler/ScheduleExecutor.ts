import type { Schedule } from '@prisma/client';
import type { Logger } from 'pino';
import type { ScheduleRepository } from '../../repositories/schedule.repository.js';
import type { JobRepository } from '../../repositories/job.repository.js';
import type { QueueManager } from '../queue/QueueManager.js';
import { CronParser } from './CronParser.js';

export interface ScheduleExecutorConfig {
  checkIntervalMs: number;
  batchSize: number;
}

const DEFAULT_CONFIG: ScheduleExecutorConfig = {
  checkIntervalMs: 10000,
  batchSize: 100,
};

export class ScheduleExecutor {
  private config: ScheduleExecutorConfig;
  private running = false;
  private checkTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly scheduleRepository: ScheduleRepository,
    private readonly jobRepository: JobRepository,
    private readonly queueManager: QueueManager,
    private readonly logger: Logger,
    config?: Partial<ScheduleExecutorConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Inicia el loop de verificación de schedules.
   */
  async start(): Promise<void> {
    if (this.running) {
      this.logger.warn('ScheduleExecutor already running');
      return;
    }

    this.running = true;
    this.logger.info(
      { checkIntervalMs: this.config.checkIntervalMs },
      'ScheduleExecutor started'
    );

    // Ejecutar inmediatamente al iniciar
    await this.checkAndExecute();

    // Configurar intervalo
    this.checkTimer = setInterval(
      () => void this.checkAndExecute(),
      this.config.checkIntervalMs
    );

    // Registrar handlers de señales
    this.registerSignalHandlers();
  }

  /**
   * Detiene el executor.
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.logger.info('ScheduleExecutor stopping...');
    this.running = false;

    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }

    this.logger.info('ScheduleExecutor stopped');
  }

  /**
   * Verifica schedules y ejecuta los que están listos.
   */
  private async checkAndExecute(): Promise<void> {
    if (!this.running) return;

    try {
      const now = new Date();
      const dueSchedules = await this.scheduleRepository.findDueSchedules(now);

      if (dueSchedules.length === 0) {
        this.logger.debug('No schedules due for execution');
        return;
      }

      this.logger.info(
        { count: dueSchedules.length },
        'Found schedules due for execution'
      );

      // Procesar cada schedule
      for (const schedule of dueSchedules) {
        if (!this.running) break;
        await this.executeSchedule(schedule);
      }
    } catch (error) {
      this.logger.error({ error }, 'Error checking schedules');
    }
  }

  /**
   * Ejecuta un schedule individual: crea job y actualiza nextRunAt.
   */
  private async executeSchedule(schedule: Schedule): Promise<void> {
    try {
      this.logger.info(
        { scheduleId: schedule.id, name: schedule.name },
        'Executing schedule'
      );

      // 1. Crear el job basado en el template del schedule
      const job = await this.jobRepository.create({
        name: `${schedule.name} (scheduled)`,
        type: schedule.jobType,
        payload: schedule.jobPayload as Record<string, unknown>,
        priority: schedule.jobPriority,
        maxRetries: 3,
        retryDelay: 1000,
      });

      // 2. Vincular job al schedule
      await this.jobRepository.update(job.id, { scheduleId: schedule.id });

      // 3. Encolar el job
      await this.queueManager.enqueue(job.id, job.priority);
      await this.jobRepository.updateStatus(job.id, 'QUEUED');

      this.logger.info(
        { scheduleId: schedule.id, jobId: job.id },
        'Job created from schedule'
      );

      // 4. Calcular próxima ejecución y actualizar schedule
      const nextRunAt = CronParser.getNextRun(schedule.cronExpr, schedule.timezone);
      await this.scheduleRepository.markExecuted(schedule.id, nextRunAt);

      this.logger.info(
        { scheduleId: schedule.id, nextRunAt },
        'Schedule executed, next run calculated'
      );
    } catch (error) {
      this.logger.error(
        { scheduleId: schedule.id, error },
        'Error executing schedule'
      );

      // En caso de error, intentar calcular nextRunAt de todas formas
      // para evitar que el schedule se quede "atascado"
      try {
        const nextRunAt = CronParser.getNextRun(schedule.cronExpr, schedule.timezone);
        await this.scheduleRepository.update(schedule.id, { nextRunAt });
      } catch {
        this.logger.error(
          { scheduleId: schedule.id },
          'Failed to update nextRunAt after error'
        );
      }
    }
  }

  /**
   * Registra handlers para shutdown graceful.
   */
  private registerSignalHandlers(): void {
    const shutdown = async (signal: string) => {
      this.logger.info({ signal }, 'ScheduleExecutor received shutdown signal');
      await this.stop();
    };

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
  }
}
