import type { Job } from '@prisma/client';
import type { JobRepository } from '../repositories/job.repository.js';
import type { PaginatedResult } from '../repositories/job.repository.js';
import type {
  CreateJobInput,
  ListJobsQuery,
  UpdateJobInput,
} from '../api/validators/job.validator.js';
import { NotFoundError, BadRequestError } from '../domain/errors/http.errors.js';
import type { QueueManager } from '../core/queue/QueueManager.js';

export class JobService {
  constructor(
    private readonly jobRepository: JobRepository,
    private readonly queueManager: QueueManager
  ) {}

  async create(input: CreateJobInput): Promise<Job> {
    const job = await this.jobRepository.create(input);

    if (job.scheduledAt && job.scheduledAt > new Date()) {
      await this.queueManager.enqueueDelayed(job.id, job.scheduledAt, job.priority);
    } else {
      await this.queueManager.enqueue(job.id, job.priority);
    }
    return this.jobRepository.updateStatus(job.id, 'QUEUED');
  }
  async getById(id: string): Promise<Job> {
    const job = await this.jobRepository.findById(id);
    if (!job) {
      throw new NotFoundError('Job', id);
    }
    return job;
  }
  async list(query: ListJobsQuery): Promise<PaginatedResult<Job>> {
    return this.jobRepository.findMany(query);
  }
  async update(id: string, input: UpdateJobInput): Promise<Job> {
    const job = await this.jobRepository.findById(id);
    if (!job) {
      throw new NotFoundError('Job', id);
    }
    if (['PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) {
      throw new BadRequestError(`Cannot update job with status '${job.status}'`);
    }

    return this.jobRepository.update(id, input);
  }
  async delete(id: string): Promise<void> {
    const job = await this.jobRepository.findById(id);
    if (!job) {
      throw new NotFoundError('Job', id);
    }
    if (job.status === 'PROCESSING') {
      throw new BadRequestError('Cannot delete a job that is currently processing');
    }

    await this.jobRepository.delete(id);
  }
  async cancel(id: string): Promise<Job> {
    const job = await this.jobRepository.findById(id);
    if (!job) {
      throw new NotFoundError('Job', id);
    }
    if (!['PENDING', 'QUEUED', 'RETRYING'].includes(job.status)) {
      throw new BadRequestError(`Cannot cancel job with status '${job.status}'`);
    }

    return this.jobRepository.cancel(id);
  }
}
