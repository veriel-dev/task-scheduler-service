import type { PrismaClient, Schedule, Prisma, JobPriority, Job } from '@prisma/client';
import type { PaginatedResult } from './job.repository.js';

export interface CreateScheduleInput {
  name: string;
  description?: string;
  cronExpr: string;
  timezone?: string;
  jobType: string;
  jobPayload: Record<string, unknown>;
  jobPriority?: JobPriority;
  enabled?: boolean;
}

export interface UpdateScheduleInput {
  name?: string;
  description?: string | null;
  cronExpr?: string;
  timezone?: string;
  jobType?: string;
  jobPayload?: Record<string, unknown>;
  jobPriority?: JobPriority;
  enabled?: boolean;
}

export interface ListSchedulesQuery {
  enabled?: boolean;
  page: number;
  limit: number;
}

export class ScheduleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateScheduleInput, nextRunAt: Date | null): Promise<Schedule> {
    return this.prisma.schedule.create({
      data: {
        name: input.name,
        description: input.description,
        cronExpr: input.cronExpr,
        timezone: input.timezone ?? 'UTC',
        jobType: input.jobType,
        jobPayload: input.jobPayload as Prisma.InputJsonValue,
        jobPriority: input.jobPriority ?? 'NORMAL',
        enabled: input.enabled ?? true,
        nextRunAt,
      },
    });
  }

  async findById(id: string): Promise<Schedule | null> {
    return this.prisma.schedule.findUnique({
      where: { id },
    });
  }

  async findByIdWithJobs(
    id: string,
    jobLimit: number = 10
  ): Promise<(Schedule & { jobs: Job[] }) | null> {
    return this.prisma.schedule.findUnique({
      where: { id },
      include: {
        jobs: {
          orderBy: { createdAt: 'desc' },
          take: jobLimit,
        },
      },
    });
  }

  async findMany(query: ListSchedulesQuery): Promise<PaginatedResult<Schedule>> {
    const { page, limit, enabled } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ScheduleWhereInput = {};
    if (enabled !== undefined) where.enabled = enabled;

    const [data, total] = await Promise.all([
      this.prisma.schedule.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.schedule.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async update(
    id: string,
    input: UpdateScheduleInput & { nextRunAt?: Date | null }
  ): Promise<Schedule> {
    const { nextRunAt, jobPayload, ...rest } = input;

    return this.prisma.schedule.update({
      where: { id },
      data: {
        ...rest,
        ...(nextRunAt !== undefined && { nextRunAt }),
        ...(jobPayload !== undefined && { jobPayload: jobPayload as Prisma.InputJsonValue }),
      },
    });
  }

  async delete(id: string): Promise<Schedule> {
    return this.prisma.schedule.delete({
      where: { id },
    });
  }

  /**
   * Encuentra schedules listos para ejecutar.
   * enabled = true AND nextRunAt <= now
   */
  async findDueSchedules(now: Date): Promise<Schedule[]> {
    return this.prisma.schedule.findMany({
      where: {
        enabled: true,
        nextRunAt: {
          lte: now,
        },
      },
      orderBy: { nextRunAt: 'asc' },
    });
  }

  /**
   * Actualiza lastRunAt, nextRunAt y runCount después de ejecutar.
   */
  async markExecuted(id: string, nextRunAt: Date | null): Promise<Schedule> {
    return this.prisma.schedule.update({
      where: { id },
      data: {
        lastRunAt: new Date(),
        nextRunAt,
        runCount: { increment: 1 },
      },
    });
  }

  /**
   * Habilita o deshabilita un schedule.
   */
  async setEnabled(id: string, enabled: boolean, nextRunAt?: Date | null): Promise<Schedule> {
    return this.prisma.schedule.update({
      where: { id },
      data: {
        enabled,
        ...(nextRunAt !== undefined && { nextRunAt }),
      },
    });
  }
}
