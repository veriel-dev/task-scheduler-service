import type { Job } from '@prisma/client';
import type { JobRepository } from '../repositories/job.repository.js';
import type { PaginatedResult } from '../repositories/job.repository.js';
import type {
  CreateJobInput,
  ListJobsQuery,
  UpdateJobInput,
} from '../api/validators/job.validator.js';
import { NotFoundError, BadRequestError } from '../domain/errors/http.errors.js';

export class JobService {
  constructor(private readonly jobRepository: JobRepository) {}

  async create(input: CreateJobInput): Promise<Job> {
    return this.jobRepository.create(input);
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
