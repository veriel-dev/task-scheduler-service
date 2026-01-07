import type { PrismaClient } from '@prisma/client';
import type { RedisClientType } from 'redis';
import type { QueueManager } from '../core/queue/QueueManager.js';

export interface QueueStats {
  priority: number;
  delayed: number;
  processing: number;
  dlq: number;
}

export interface WorkerStats {
  total: number;
  active: number;
  idle: number;
  stopped: number;
  totalProcessed: number;
  totalFailed: number;
}

export interface JobStats {
  total: number;
  byStatus: Record<string, number>;
  last24h: {
    created: number;
    completed: number;
    failed: number;
  };
}

export interface ScheduleStats {
  total: number;
  enabled: number;
  disabled: number;
  totalRuns: number;
}

export interface SystemOverview {
  queues: QueueStats;
  workers: WorkerStats;
  jobs: JobStats;
  schedules: ScheduleStats;
  uptime: number;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: {
    database: { status: 'ok' | 'error'; latencyMs?: number; error?: string };
    redis: { status: 'ok' | 'error'; latencyMs?: number; error?: string };
    workers: { status: 'ok' | 'warning' | 'error'; activeCount: number; message?: string };
  };
}

export class MetricsService {
  private startTime: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: RedisClientType,
    private readonly queueManager: QueueManager
  ) {
    this.startTime = Date.now();
  }

  async getQueueStats(): Promise<QueueStats> {
    return this.queueManager.getStats();
  }

  async getWorkerStats(): Promise<WorkerStats> {
    const workers = await this.prisma.worker.findMany();

    const stats: WorkerStats = {
      total: workers.length,
      active: 0,
      idle: 0,
      stopped: 0,
      totalProcessed: 0,
      totalFailed: 0,
    };

    for (const worker of workers) {
      if (worker.status === 'active') stats.active++;
      else if (worker.status === 'idle') stats.idle++;
      else if (worker.status === 'stopped') stats.stopped++;

      stats.totalProcessed += worker.processedCount;
      stats.totalFailed += worker.failedCount;
    }

    return stats;
  }

  async getJobStats(): Promise<JobStats> {
    const [total, byStatusRaw, last24hCreated, last24hCompleted, last24hFailed] = await Promise.all(
      [
        this.prisma.job.count(),
        this.prisma.job.groupBy({
          by: ['status'],
          _count: { status: true },
        }),
        this.prisma.job.count({
          where: {
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
        }),
        this.prisma.job.count({
          where: {
            status: 'COMPLETED',
            completedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
        }),
        this.prisma.job.count({
          where: {
            status: 'FAILED',
            completedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
        }),
      ]
    );

    const byStatus: Record<string, number> = {};
    for (const item of byStatusRaw) {
      byStatus[item.status] = item._count.status;
    }

    return {
      total,
      byStatus,
      last24h: {
        created: last24hCreated,
        completed: last24hCompleted,
        failed: last24hFailed,
      },
    };
  }

  async getScheduleStats(): Promise<ScheduleStats> {
    const [total, enabled, totalRuns] = await Promise.all([
      this.prisma.schedule.count(),
      this.prisma.schedule.count({ where: { enabled: true } }),
      this.prisma.schedule.aggregate({ _sum: { runCount: true } }),
    ]);

    return {
      total,
      enabled,
      disabled: total - enabled,
      totalRuns: totalRuns._sum.runCount ?? 0,
    };
  }

  async getOverview(): Promise<SystemOverview> {
    const [queues, workers, jobs, schedules] = await Promise.all([
      this.getQueueStats(),
      this.getWorkerStats(),
      this.getJobStats(),
      this.getScheduleStats(),
    ]);

    return {
      queues,
      workers,
      jobs,
      schedules,
      uptime: Date.now() - this.startTime,
    };
  }

  async getHealthStatus(): Promise<HealthStatus> {
    const checks: HealthStatus['checks'] = {
      database: { status: 'ok' },
      redis: { status: 'ok' },
      workers: { status: 'ok', activeCount: 0 },
    };

    // Check database
    try {
      const dbStart = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database.latencyMs = Date.now() - dbStart;
    } catch (error) {
      checks.database.status = 'error';
      checks.database.error = error instanceof Error ? error.message : 'Unknown error';
    }

    // Check Redis
    try {
      const redisStart = Date.now();
      await this.redis.ping();
      checks.redis.latencyMs = Date.now() - redisStart;
    } catch (error) {
      checks.redis.status = 'error';
      checks.redis.error = error instanceof Error ? error.message : 'Unknown error';
    }

    // Check workers
    try {
      const activeWorkers = await this.prisma.worker.count({
        where: { status: 'active' },
      });
      checks.workers.activeCount = activeWorkers;

      if (activeWorkers === 0) {
        checks.workers.status = 'warning';
        checks.workers.message = 'No active workers';
      }
    } catch {
      checks.workers.status = 'error';
    }

    // Determine overall status
    let status: HealthStatus['status'] = 'healthy';
    if (checks.database.status === 'error' || checks.redis.status === 'error') {
      status = 'unhealthy';
    } else if (checks.workers.status === 'warning') {
      status = 'degraded';
    }

    return { status, checks };
  }
}
