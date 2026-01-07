import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OrphanJobRecovery } from '../OrphanJobRecovery.js';
import type { JobRepository } from '../../../repositories/job.repository.js';
import type { WorkerRepository } from '../../../repositories/worker.repository.js';
import type { QueueManager } from '../../queue/QueueManager.js';
import type { Logger } from '../../../infrastructure/index.js';

const mockStaleWorker = {
  id: 'worker-123',
  name: 'worker-1',
  hostname: 'localhost',
  pid: 1234,
  status: 'active',
  concurrency: 1,
  activeJobs: 1,
  processedCount: 10,
  failedCount: 2,
  lastHeartbeat: new Date(Date.now() - 120000), // 2 minutes ago
  startedAt: new Date(),
  stoppedAt: null,
};

const mockOrphanJob = {
  id: 'job-456',
  name: 'Orphan Job',
  type: 'test.job',
  payload: { key: 'value' },
  status: 'PROCESSING' as const,
  priority: 'NORMAL' as const,
  maxRetries: 3,
  retryCount: 1,
  retryDelay: 1000,
  scheduledAt: null,
  webhookUrl: null,
  workerId: 'worker-123',
  scheduleId: null,
  result: null,
  error: null,
  startedAt: new Date(),
  completedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('OrphanJobRecovery', () => {
  let recovery: OrphanJobRecovery;
  let mockJobRepository: {
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let mockWorkerRepository: {
    findStaleWorkers: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
  let mockQueueManager: {
    markCompleted: ReturnType<typeof vi.fn>;
    requeue: ReturnType<typeof vi.fn>;
  };
  let mockLogger: Logger;

  beforeEach(() => {
    vi.useFakeTimers();

    mockJobRepository = {
      findMany: vi.fn(),
      update: vi.fn(),
    };

    mockWorkerRepository = {
      findStaleWorkers: vi.fn(),
      stop: vi.fn(),
    };

    mockQueueManager = {
      markCompleted: vi.fn(),
      requeue: vi.fn(),
    };

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as unknown as Logger;

    recovery = new OrphanJobRecovery(
      mockJobRepository as unknown as JobRepository,
      mockWorkerRepository as unknown as WorkerRepository,
      mockQueueManager as unknown as QueueManager,
      mockLogger,
      {
        checkIntervalMs: 60000,
        staleThresholdMs: 90000,
        recoveryDelayMs: 5000,
      }
    );
  });

  afterEach(() => {
    recovery.stop();
    vi.useRealTimers();
  });

  describe('recover', () => {
    it('should do nothing when no stale workers found', async () => {
      mockWorkerRepository.findStaleWorkers.mockResolvedValue([]);

      const result = await recovery.recover();

      expect(result).toEqual({ staleWorkers: 0, orphanJobs: 0 });
      expect(mockWorkerRepository.findStaleWorkers).toHaveBeenCalledWith(90000);
    });

    it('should recover orphan jobs from stale workers', async () => {
      mockWorkerRepository.findStaleWorkers.mockResolvedValue([mockStaleWorker]);
      mockJobRepository.findMany.mockResolvedValue({
        data: [mockOrphanJob],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      });
      mockJobRepository.update.mockResolvedValue({ ...mockOrphanJob, status: 'RETRYING' });
      mockQueueManager.markCompleted.mockResolvedValue(undefined);
      mockQueueManager.requeue.mockResolvedValue(undefined);
      mockWorkerRepository.stop.mockResolvedValue({ ...mockStaleWorker, status: 'stopped' });

      const result = await recovery.recover();

      expect(result).toEqual({ staleWorkers: 1, orphanJobs: 1 });
      expect(mockJobRepository.update).toHaveBeenCalledWith(mockOrphanJob.id, {
        status: 'RETRYING',
        retryCount: 2,
        error: 'Worker died - job recovered automatically',
        workerId: null,
      });
      expect(mockQueueManager.markCompleted).toHaveBeenCalledWith(mockOrphanJob.id);
      expect(mockQueueManager.requeue).toHaveBeenCalledWith(mockOrphanJob.id, 'NORMAL', 5000);
      expect(mockWorkerRepository.stop).toHaveBeenCalledWith(mockStaleWorker.id);
    });

    it('should handle multiple stale workers', async () => {
      const staleWorker2 = { ...mockStaleWorker, id: 'worker-456' };
      const orphanJob2 = { ...mockOrphanJob, id: 'job-789', workerId: 'worker-456' };

      mockWorkerRepository.findStaleWorkers.mockResolvedValue([mockStaleWorker, staleWorker2]);
      mockJobRepository.findMany
        .mockResolvedValueOnce({ data: [mockOrphanJob], total: 1, page: 1, limit: 100, totalPages: 1 })
        .mockResolvedValueOnce({ data: [orphanJob2], total: 1, page: 1, limit: 100, totalPages: 1 });
      mockJobRepository.update.mockResolvedValue({ status: 'RETRYING' });
      mockQueueManager.markCompleted.mockResolvedValue(undefined);
      mockQueueManager.requeue.mockResolvedValue(undefined);
      mockWorkerRepository.stop.mockResolvedValue({ status: 'stopped' });

      const result = await recovery.recover();

      expect(result).toEqual({ staleWorkers: 2, orphanJobs: 2 });
      expect(mockWorkerRepository.stop).toHaveBeenCalledTimes(2);
    });

    it('should handle errors gracefully', async () => {
      mockWorkerRepository.findStaleWorkers.mockRejectedValue(new Error('Database error'));

      const result = await recovery.recover();

      expect(result).toEqual({ staleWorkers: 0, orphanJobs: 0 });
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('start/stop', () => {
    it('should start periodic recovery', async () => {
      mockWorkerRepository.findStaleWorkers.mockResolvedValue([]);

      recovery.start();

      // Initial call
      await vi.advanceTimersByTimeAsync(0);
      expect(mockWorkerRepository.findStaleWorkers).toHaveBeenCalledTimes(1);

      // After interval
      await vi.advanceTimersByTimeAsync(60000);
      expect(mockWorkerRepository.findStaleWorkers).toHaveBeenCalledTimes(2);
    });

    it('should stop periodic recovery', async () => {
      mockWorkerRepository.findStaleWorkers.mockResolvedValue([]);

      recovery.start();
      await vi.advanceTimersByTimeAsync(0);

      recovery.stop();

      await vi.advanceTimersByTimeAsync(60000);
      expect(mockWorkerRepository.findStaleWorkers).toHaveBeenCalledTimes(1);
    });

    it('should warn if already running', () => {
      recovery.start();
      recovery.start();

      expect(mockLogger.warn).toHaveBeenCalledWith('OrphanJobRecovery already running');
    });
  });
});
