import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetricsService } from '../metrics.service.js';
import type { PrismaClient } from '@prisma/client';
import type { RedisClientType } from 'redis';
import type { QueueManager } from '../../core/queue/QueueManager.js';

describe('MetricsService', () => {
  let service: MetricsService;
  let mockPrisma: {
    job: { count: ReturnType<typeof vi.fn>; groupBy: ReturnType<typeof vi.fn> };
    worker: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
    schedule: { count: ReturnType<typeof vi.fn>; aggregate: ReturnType<typeof vi.fn> };
    $queryRaw: ReturnType<typeof vi.fn>;
  };
  let mockRedis: {
    ping: ReturnType<typeof vi.fn>;
  };
  let mockQueueManager: {
    getStats: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockPrisma = {
      job: {
        count: vi.fn(),
        groupBy: vi.fn(),
      },
      worker: {
        findMany: vi.fn(),
        count: vi.fn(),
      },
      schedule: {
        count: vi.fn(),
        aggregate: vi.fn(),
      },
      $queryRaw: vi.fn(),
    };

    mockRedis = {
      ping: vi.fn(),
    };

    mockQueueManager = {
      getStats: vi.fn(),
    };

    service = new MetricsService(
      mockPrisma as unknown as PrismaClient,
      mockRedis as unknown as RedisClientType,
      mockQueueManager as unknown as QueueManager
    );
  });

  describe('getQueueStats', () => {
    it('should return queue statistics from QueueManager', async () => {
      const mockStats = { priority: 10, delayed: 5, processing: 3, dlq: 2 };
      mockQueueManager.getStats.mockResolvedValue(mockStats);

      const result = await service.getQueueStats();

      expect(result).toEqual(mockStats);
      expect(mockQueueManager.getStats).toHaveBeenCalled();
    });
  });

  describe('getWorkerStats', () => {
    it('should aggregate worker statistics', async () => {
      const mockWorkers = [
        { status: 'active', processedCount: 100, failedCount: 5 },
        { status: 'active', processedCount: 80, failedCount: 3 },
        { status: 'idle', processedCount: 50, failedCount: 2 },
        { status: 'stopped', processedCount: 200, failedCount: 10 },
      ];
      mockPrisma.worker.findMany.mockResolvedValue(mockWorkers);

      const result = await service.getWorkerStats();

      expect(result).toEqual({
        total: 4,
        active: 2,
        idle: 1,
        stopped: 1,
        totalProcessed: 430,
        totalFailed: 20,
      });
    });

    it('should handle empty workers', async () => {
      mockPrisma.worker.findMany.mockResolvedValue([]);

      const result = await service.getWorkerStats();

      expect(result).toEqual({
        total: 0,
        active: 0,
        idle: 0,
        stopped: 0,
        totalProcessed: 0,
        totalFailed: 0,
      });
    });
  });

  describe('getJobStats', () => {
    it('should return job statistics', async () => {
      mockPrisma.job.count
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(20) // last24h created
        .mockResolvedValueOnce(15) // last24h completed
        .mockResolvedValueOnce(3); // last24h failed

      mockPrisma.job.groupBy.mockResolvedValue([
        { status: 'COMPLETED', _count: { status: 60 } },
        { status: 'FAILED', _count: { status: 10 } },
        { status: 'QUEUED', _count: { status: 30 } },
      ]);

      const result = await service.getJobStats();

      expect(result).toEqual({
        total: 100,
        byStatus: {
          COMPLETED: 60,
          FAILED: 10,
          QUEUED: 30,
        },
        last24h: {
          created: 20,
          completed: 15,
          failed: 3,
        },
      });
    });
  });

  describe('getScheduleStats', () => {
    it('should return schedule statistics', async () => {
      mockPrisma.schedule.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(8); // enabled

      mockPrisma.schedule.aggregate.mockResolvedValue({
        _sum: { runCount: 150 },
      });

      const result = await service.getScheduleStats();

      expect(result).toEqual({
        total: 10,
        enabled: 8,
        disabled: 2,
        totalRuns: 150,
      });
    });

    it('should handle null runCount sum', async () => {
      mockPrisma.schedule.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      mockPrisma.schedule.aggregate.mockResolvedValue({
        _sum: { runCount: null },
      });

      const result = await service.getScheduleStats();

      expect(result.totalRuns).toBe(0);
    });
  });

  describe('getHealthStatus', () => {
    it('should return healthy status when all checks pass', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      mockRedis.ping.mockResolvedValue('PONG');
      mockPrisma.worker.count.mockResolvedValue(2);

      const result = await service.getHealthStatus();

      expect(result.status).toBe('healthy');
      expect(result.checks.database.status).toBe('ok');
      expect(result.checks.redis.status).toBe('ok');
      expect(result.checks.workers.status).toBe('ok');
      expect(result.checks.workers.activeCount).toBe(2);
    });

    it('should return degraded status when no active workers', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      mockRedis.ping.mockResolvedValue('PONG');
      mockPrisma.worker.count.mockResolvedValue(0);

      const result = await service.getHealthStatus();

      expect(result.status).toBe('degraded');
      expect(result.checks.workers.status).toBe('warning');
      expect(result.checks.workers.message).toBe('No active workers');
    });

    it('should return unhealthy status when database fails', async () => {
      mockPrisma.$queryRaw.mockRejectedValue(new Error('Connection refused'));
      mockRedis.ping.mockResolvedValue('PONG');
      mockPrisma.worker.count.mockResolvedValue(2);

      const result = await service.getHealthStatus();

      expect(result.status).toBe('unhealthy');
      expect(result.checks.database.status).toBe('error');
      expect(result.checks.database.error).toBe('Connection refused');
    });

    it('should return unhealthy status when Redis fails', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      mockRedis.ping.mockRejectedValue(new Error('Redis connection error'));
      mockPrisma.worker.count.mockResolvedValue(2);

      const result = await service.getHealthStatus();

      expect(result.status).toBe('unhealthy');
      expect(result.checks.redis.status).toBe('error');
      expect(result.checks.redis.error).toBe('Redis connection error');
    });

    it('should include latency measurements', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      mockRedis.ping.mockResolvedValue('PONG');
      mockPrisma.worker.count.mockResolvedValue(1);

      const result = await service.getHealthStatus();

      expect(result.checks.database.latencyMs).toBeDefined();
      expect(result.checks.redis.latencyMs).toBeDefined();
    });
  });

  describe('getOverview', () => {
    it('should return complete system overview', async () => {
      // Queue stats
      mockQueueManager.getStats.mockResolvedValue({
        priority: 10,
        delayed: 5,
        processing: 3,
        dlq: 2,
      });

      // Worker stats
      mockPrisma.worker.findMany.mockResolvedValue([
        { status: 'active', processedCount: 100, failedCount: 5 },
      ]);

      // Job stats
      mockPrisma.job.count.mockResolvedValue(50);
      mockPrisma.job.groupBy.mockResolvedValue([
        { status: 'COMPLETED', _count: { status: 40 } },
      ]);

      // Schedule stats
      mockPrisma.schedule.count.mockResolvedValue(5);
      mockPrisma.schedule.aggregate.mockResolvedValue({ _sum: { runCount: 100 } });

      const result = await service.getOverview();

      expect(result.queues).toBeDefined();
      expect(result.workers).toBeDefined();
      expect(result.jobs).toBeDefined();
      expect(result.schedules).toBeDefined();
      expect(result.uptime).toBeGreaterThanOrEqual(0);
    });
  });
});
