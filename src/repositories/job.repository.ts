import type { PrismaClient, Job, JobStatus, Prisma } from '@prisma/client';
import type {
  CreateJobInput,
  UpdateJobInput,
  ListJobsQuery,
} from '../api/validators/job.validator.js';

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export class JobRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateJobInput): Promise<Job> {
    return this.prisma.job.create({
      data: {
        name: input.name,
        type: input.type,
        payload: input.payload as Prisma.InputJsonValue,
        priority: input.priority,
        maxRetries: input.maxRetries,
        retryDelay: input.retryDelay,
        scheduledAt: input.scheduledAt,
        webhookUrl: input.webhookUrl,
      },
    });
  }

  async findById(id: string): Promise<Job | null> {
    return this.prisma.job.findUnique({
      where: { id },
    });
  }

  async findMany(query: ListJobsQuery): Promise<PaginatedResult<Job>> {
    const { page, limit, status, type, priority } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.JobWhereInput = {};
    if (status) where.status = status;
    if (type) where.type = type;
    if (priority) where.priority = priority;

    const [data, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.job.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async update(id: string, input: UpdateJobInput): Promise<Job> {
    return this.prisma.job.update({
      where: { id },
      data: input,
    });
  }

  async delete(id: string): Promise<Job> {
    return this.prisma.job.delete({
      where: { id },
    });
  }

  async updateStatus(id: string, status: JobStatus): Promise<Job> {
    return this.prisma.job.update({
      where: { id },
      data: { status },
    });
  }

  async cancel(id: string): Promise<Job> {
    return this.prisma.job.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        completedAt: new Date(),
      },
    });
  }
}
