import type { PrismaClient, DeadLetterJob, JobPriority, Prisma } from '@prisma/client';

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ListDeadLetterQuery {
  page: number;
  limit: number;
  jobType?: string;
}

export interface CreateDeadLetterInput {
  originalJobId: string;
  jobName: string;
  jobType: string;
  jobPayload: Prisma.InputJsonValue;
  jobPriority: JobPriority;
  failureReason: string;
  failureCount: number;
  lastError?: string;
  errorStack?: string;
  workerId?: string;
  originalCreatedAt: Date;
}

export interface DeadLetterStats {
  total: number;
  byType: { jobType: string; count: number }[];
  oldest?: Date;
  newest?: Date;
}

export class DeadLetterRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateDeadLetterInput): Promise<DeadLetterJob> {
    return this.prisma.deadLetterJob.create({
      data: {
        originalJobId: input.originalJobId,
        jobName: input.jobName,
        jobType: input.jobType,
        jobPayload: input.jobPayload,
        jobPriority: input.jobPriority,
        failureReason: input.failureReason,
        failureCount: input.failureCount,
        lastError: input.lastError,
        errorStack: input.errorStack,
        workerId: input.workerId,
        originalCreatedAt: input.originalCreatedAt,
      },
    });
  }

  async findById(id: string): Promise<DeadLetterJob | null> {
    return this.prisma.deadLetterJob.findUnique({
      where: { id },
    });
  }

  async findByOriginalJobId(originalJobId: string): Promise<DeadLetterJob | null> {
    return this.prisma.deadLetterJob.findFirst({
      where: { originalJobId },
    });
  }

  async findMany(query: ListDeadLetterQuery): Promise<PaginatedResult<DeadLetterJob>> {
    const { page, limit, jobType } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.DeadLetterJobWhereInput = {};
    if (jobType) where.jobType = jobType;

    const [data, total] = await Promise.all([
      this.prisma.deadLetterJob.findMany({
        where,
        skip,
        take: limit,
        orderBy: { failedAt: 'desc' },
      }),
      this.prisma.deadLetterJob.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async delete(id: string): Promise<DeadLetterJob> {
    return this.prisma.deadLetterJob.delete({
      where: { id },
    });
  }

  async getStats(): Promise<DeadLetterStats> {
    const [total, byTypeRaw, oldest, newest] = await Promise.all([
      this.prisma.deadLetterJob.count(),
      this.prisma.deadLetterJob.groupBy({
        by: ['jobType'],
        _count: { jobType: true },
        orderBy: { _count: { jobType: 'desc' } },
      }),
      this.prisma.deadLetterJob.findFirst({
        orderBy: { failedAt: 'asc' },
        select: { failedAt: true },
      }),
      this.prisma.deadLetterJob.findFirst({
        orderBy: { failedAt: 'desc' },
        select: { failedAt: true },
      }),
    ]);

    return {
      total,
      byType: byTypeRaw.map((item) => ({
        jobType: item.jobType,
        count: item._count.jobType,
      })),
      oldest: oldest?.failedAt,
      newest: newest?.failedAt,
    };
  }
}
