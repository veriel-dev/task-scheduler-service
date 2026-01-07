import type { DeadLetterJob, Job } from '@prisma/client';
import type {
  DeadLetterRepository,
  PaginatedResult,
  DeadLetterStats,
} from '../repositories/dead-letter.repository.js';
import type { JobRepository } from '../repositories/job.repository.js';
import type { QueueManager } from '../core/queue/QueueManager.js';
import type { ListDeadLetterQuery } from '../api/validators/dead-letter.validator.js';
import { NotFoundError } from '../domain/errors/http.errors.js';

export class DeadLetterService {
  constructor(
    private readonly deadLetterRepository: DeadLetterRepository,
    private readonly jobRepository: JobRepository,
    private readonly queueManager: QueueManager
  ) {}

  async list(query: ListDeadLetterQuery): Promise<PaginatedResult<DeadLetterJob>> {
    return this.deadLetterRepository.findMany(query);
  }

  async getById(id: string): Promise<DeadLetterJob> {
    const deadLetterJob = await this.deadLetterRepository.findById(id);
    if (!deadLetterJob) {
      throw new NotFoundError('DeadLetterJob', id);
    }
    return deadLetterJob;
  }

  /**
   * Reintenta un job de la DLQ creando uno nuevo con los mismos datos
   * Retorna el nuevo job creado
   */
  async retry(id: string): Promise<Job> {
    const deadLetterJob = await this.deadLetterRepository.findById(id);
    if (!deadLetterJob) {
      throw new NotFoundError('DeadLetterJob', id);
    }

    // Crear nuevo job con los datos originales
    const newJob = await this.jobRepository.create({
      name: `${deadLetterJob.jobName} (retry)`,
      type: deadLetterJob.jobType,
      payload: deadLetterJob.jobPayload as Record<string, unknown>,
      priority: deadLetterJob.jobPriority,
    });

    // Encolar el nuevo job
    await this.queueManager.enqueue(newJob.id, newJob.priority);
    const queuedJob = await this.jobRepository.updateStatus(newJob.id, 'QUEUED');

    // Eliminar de la DLQ
    await this.deadLetterRepository.delete(id);

    // Eliminar de Redis DLQ también
    await this.queueManager.removeFromDLQ(deadLetterJob.originalJobId);

    return queuedJob;
  }

  async delete(id: string): Promise<void> {
    const deadLetterJob = await this.deadLetterRepository.findById(id);
    if (!deadLetterJob) {
      throw new NotFoundError('DeadLetterJob', id);
    }

    await this.deadLetterRepository.delete(id);
    // También eliminar de Redis DLQ
    await this.queueManager.removeFromDLQ(deadLetterJob.originalJobId);
  }

  async getStats(): Promise<DeadLetterStats> {
    return this.deadLetterRepository.getStats();
  }
}
