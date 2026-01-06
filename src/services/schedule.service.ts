import type { Schedule, Job } from '@prisma/client';
import type { ScheduleRepository } from '../repositories/schedule.repository.js';
import type { JobRepository } from '../repositories/job.repository.js';
import type { PaginatedResult } from '../repositories/job.repository.js';
import type { QueueManager } from '../core/queue/QueueManager.js';
import type {
  CreateScheduleInput,
  UpdateScheduleInput,
  ListSchedulesQuery,
} from '../api/validators/schedule.validator.js';
import { CronParser } from '../core/scheduler/CronParser.js';
import { NotFoundError, BadRequestError } from '../domain/errors/http.errors.js';

export class ScheduleService {
  constructor(
    private readonly scheduleRepository: ScheduleRepository,
    private readonly jobRepository: JobRepository,
    private readonly queueManager: QueueManager
  ) {}

  /**
   * Crea un nuevo schedule.
   */
  async create(input: CreateScheduleInput): Promise<Schedule> {
    const nextRunAt = input.enabled ? CronParser.getNextRun(input.cronExpr, input.timezone) : null;

    return this.scheduleRepository.create(input, nextRunAt);
  }

  /**
   * Obtiene un schedule por ID.
   */
  async getById(id: string): Promise<Schedule> {
    const schedule = await this.scheduleRepository.findById(id);
    if (!schedule) {
      throw new NotFoundError('Schedule', id);
    }
    return schedule;
  }

  /**
   * Obtiene un schedule con sus jobs recientes.
   */
  async getByIdWithJobs(id: string, jobLimit: number = 10): Promise<Schedule & { jobs: Job[] }> {
    const schedule = await this.scheduleRepository.findByIdWithJobs(id, jobLimit);
    if (!schedule) {
      throw new NotFoundError('Schedule', id);
    }
    return schedule;
  }

  /**
   * Lista schedules con paginación.
   */
  async list(query: ListSchedulesQuery): Promise<PaginatedResult<Schedule>> {
    return this.scheduleRepository.findMany(query);
  }

  /**
   * Actualiza un schedule.
   */
  async update(id: string, input: UpdateScheduleInput): Promise<Schedule> {
    const schedule = await this.scheduleRepository.findById(id);
    if (!schedule) {
      throw new NotFoundError('Schedule', id);
    }

    // Si se actualiza cronExpr, timezone o enabled, recalcular nextRunAt
    let nextRunAt: Date | null | undefined = undefined;

    const newCronExpr = input.cronExpr ?? schedule.cronExpr;
    const newTimezone = input.timezone ?? schedule.timezone;
    const newEnabled = input.enabled ?? schedule.enabled;

    if (
      input.cronExpr !== undefined ||
      input.timezone !== undefined ||
      input.enabled !== undefined
    ) {
      nextRunAt = newEnabled ? CronParser.getNextRun(newCronExpr, newTimezone) : null;
    }

    return this.scheduleRepository.update(id, { ...input, nextRunAt });
  }

  /**
   * Elimina un schedule.
   */
  async delete(id: string): Promise<void> {
    const schedule = await this.scheduleRepository.findById(id);
    if (!schedule) {
      throw new NotFoundError('Schedule', id);
    }

    await this.scheduleRepository.delete(id);
  }

  /**
   * Habilita un schedule.
   */
  async enable(id: string): Promise<Schedule> {
    const schedule = await this.scheduleRepository.findById(id);
    if (!schedule) {
      throw new NotFoundError('Schedule', id);
    }

    if (schedule.enabled) {
      throw new BadRequestError('Schedule is already enabled');
    }

    const nextRunAt = CronParser.getNextRun(schedule.cronExpr, schedule.timezone);
    return this.scheduleRepository.setEnabled(id, true, nextRunAt);
  }

  /**
   * Deshabilita un schedule.
   */
  async disable(id: string): Promise<Schedule> {
    const schedule = await this.scheduleRepository.findById(id);
    if (!schedule) {
      throw new NotFoundError('Schedule', id);
    }

    if (!schedule.enabled) {
      throw new BadRequestError('Schedule is already disabled');
    }

    return this.scheduleRepository.setEnabled(id, false, null);
  }

  /**
   * Trigger manual: crea un job inmediatamente desde el schedule.
   */
  async trigger(id: string): Promise<Job> {
    const schedule = await this.scheduleRepository.findById(id);
    if (!schedule) {
      throw new NotFoundError('Schedule', id);
    }

    // Crear job basado en el template del schedule
    const job = await this.jobRepository.create({
      name: `${schedule.name} (manual trigger)`,
      type: schedule.jobType,
      payload: schedule.jobPayload as Record<string, unknown>,
      priority: schedule.jobPriority,
      maxRetries: 3,
      retryDelay: 1000,
    });

    // Vincular job al schedule
    await this.jobRepository.update(job.id, { scheduleId: schedule.id });

    // Encolar inmediatamente
    await this.queueManager.enqueue(job.id, job.priority);

    // Actualizar status a QUEUED
    return this.jobRepository.updateStatus(job.id, 'QUEUED');
  }

  /**
   * Obtiene las próximas N ejecuciones de un schedule.
   */
  async getNextRuns(id: string, count: number = 5): Promise<Date[]> {
    const schedule = await this.scheduleRepository.findById(id);
    if (!schedule) {
      throw new NotFoundError('Schedule', id);
    }

    if (!schedule.enabled) {
      return [];
    }

    return CronParser.getNextRuns(schedule.cronExpr, schedule.timezone, count);
  }
}
