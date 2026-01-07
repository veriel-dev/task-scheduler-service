import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeadLetterService } from '../dead-letter.service.js';
import type { DeadLetterRepository } from '../../repositories/dead-letter.repository.js';
import type { JobRepository } from '../../repositories/job.repository.js';
import type { QueueManager } from '../../core/queue/QueueManager.js';
import { NotFoundError } from '../../domain/errors/http.errors.js';

const mockDeadLetterJob = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  originalJobId: '223e4567-e89b-12d3-a456-426614174001',
  jobName: 'Failed Job',
  jobType: 'test.job',
  jobPayload: { key: 'value' },
  jobPriority: 'NORMAL' as const,
  failureReason: 'Connection timeout',
  failureCount: 3,
  lastError: 'Connection timeout',
  errorStack: 'Error: Connection timeout\n    at ...',
  workerId: 'worker-123',
  originalCreatedAt: new Date('2025-01-15T10:00:00Z'),
  failedAt: new Date('2025-01-15T10:05:00Z'),
};

const mockNewJob = {
  id: '323e4567-e89b-12d3-a456-426614174002',
  name: 'Failed Job (retry)',
  type: 'test.job',
  payload: { key: 'value' },
  status: 'PENDING' as const,
  priority: 'NORMAL' as const,
  maxRetries: 3,
  retryCount: 0,
  retryDelay: 1000,
  scheduledAt: null,
  webhookUrl: null,
  workerId: null,
  scheduleId: null,
  result: null,
  error: null,
  startedAt: null,
  completedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('DeadLetterService', () => {
  let service: DeadLetterService;
  let mockDeadLetterRepository: {
    findById: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    getStats: ReturnType<typeof vi.fn>;
  };
  let mockJobRepository: {
    create: ReturnType<typeof vi.fn>;
    updateStatus: ReturnType<typeof vi.fn>;
  };
  let mockQueueManager: {
    enqueue: ReturnType<typeof vi.fn>;
    removeFromDLQ: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockDeadLetterRepository = {
      findById: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
      getStats: vi.fn(),
    };

    mockJobRepository = {
      create: vi.fn(),
      updateStatus: vi.fn(),
    };

    mockQueueManager = {
      enqueue: vi.fn(),
      removeFromDLQ: vi.fn(),
    };

    service = new DeadLetterService(
      mockDeadLetterRepository as unknown as DeadLetterRepository,
      mockJobRepository as unknown as JobRepository,
      mockQueueManager as unknown as QueueManager
    );
  });

  describe('list', () => {
    it('should return paginated dead letter jobs', async () => {
      const mockResult = {
        data: [mockDeadLetterJob],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      };
      mockDeadLetterRepository.findMany.mockResolvedValue(mockResult);

      const result = await service.list({ page: 1, limit: 20 });

      expect(result).toEqual(mockResult);
      expect(mockDeadLetterRepository.findMany).toHaveBeenCalledWith({ page: 1, limit: 20 });
    });

    it('should filter by jobType', async () => {
      mockDeadLetterRepository.findMany.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });

      await service.list({ page: 1, limit: 20, jobType: 'test.job' });

      expect(mockDeadLetterRepository.findMany).toHaveBeenCalledWith({ page: 1, limit: 20, jobType: 'test.job' });
    });
  });

  describe('getById', () => {
    it('should return a dead letter job by id', async () => {
      mockDeadLetterRepository.findById.mockResolvedValue(mockDeadLetterJob);

      const result = await service.getById(mockDeadLetterJob.id);

      expect(result).toEqual(mockDeadLetterJob);
    });

    it('should throw NotFoundError if not found', async () => {
      mockDeadLetterRepository.findById.mockResolvedValue(null);

      await expect(service.getById('non-existent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('retry', () => {
    it('should create a new job from dead letter and delete from DLQ', async () => {
      mockDeadLetterRepository.findById.mockResolvedValue(mockDeadLetterJob);
      mockJobRepository.create.mockResolvedValue(mockNewJob);
      mockJobRepository.updateStatus.mockResolvedValue({ ...mockNewJob, status: 'QUEUED' });
      mockQueueManager.enqueue.mockResolvedValue(undefined);
      mockDeadLetterRepository.delete.mockResolvedValue(mockDeadLetterJob);
      mockQueueManager.removeFromDLQ.mockResolvedValue(true);

      const result = await service.retry(mockDeadLetterJob.id);

      expect(result.status).toBe('QUEUED');
      expect(mockJobRepository.create).toHaveBeenCalledWith({
        name: `${mockDeadLetterJob.jobName} (retry)`,
        type: mockDeadLetterJob.jobType,
        payload: mockDeadLetterJob.jobPayload,
        priority: mockDeadLetterJob.jobPriority,
      });
      expect(mockQueueManager.enqueue).toHaveBeenCalled();
      expect(mockDeadLetterRepository.delete).toHaveBeenCalledWith(mockDeadLetterJob.id);
      expect(mockQueueManager.removeFromDLQ).toHaveBeenCalledWith(mockDeadLetterJob.originalJobId);
    });

    it('should throw NotFoundError if dead letter job not found', async () => {
      mockDeadLetterRepository.findById.mockResolvedValue(null);

      await expect(service.retry('non-existent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('delete', () => {
    it('should delete a dead letter job', async () => {
      mockDeadLetterRepository.findById.mockResolvedValue(mockDeadLetterJob);
      mockDeadLetterRepository.delete.mockResolvedValue(mockDeadLetterJob);
      mockQueueManager.removeFromDLQ.mockResolvedValue(true);

      await service.delete(mockDeadLetterJob.id);

      expect(mockDeadLetterRepository.delete).toHaveBeenCalledWith(mockDeadLetterJob.id);
      expect(mockQueueManager.removeFromDLQ).toHaveBeenCalledWith(mockDeadLetterJob.originalJobId);
    });

    it('should throw NotFoundError if not found', async () => {
      mockDeadLetterRepository.findById.mockResolvedValue(null);

      await expect(service.delete('non-existent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('getStats', () => {
    it('should return statistics', async () => {
      const mockStats = {
        total: 10,
        byType: [
          { jobType: 'email.send', count: 5 },
          { jobType: 'report.generate', count: 5 },
        ],
        oldest: new Date('2025-01-10T00:00:00Z'),
        newest: new Date('2025-01-15T00:00:00Z'),
      };
      mockDeadLetterRepository.getStats.mockResolvedValue(mockStats);

      const result = await service.getStats();

      expect(result).toEqual(mockStats);
    });
  });
});
