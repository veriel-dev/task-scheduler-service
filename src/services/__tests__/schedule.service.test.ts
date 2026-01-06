import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScheduleService } from '../schedule.service.js';
import type { ScheduleRepository } from '../../repositories/schedule.repository.js';
import type { JobRepository } from '../../repositories/job.repository.js';
import type { QueueManager } from '../../core/queue/QueueManager.js';
import { NotFoundError, BadRequestError } from '../../domain/errors/http.errors.js';

// Mock schedule data
const mockSchedule = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  name: 'Test Schedule',
  description: 'Test description',
  cronExpr: '0 9 * * *',
  timezone: 'UTC',
  jobType: 'test.job',
  jobPayload: { key: 'value' },
  jobPriority: 'NORMAL' as const,
  enabled: true,
  lastRunAt: null,
  nextRunAt: new Date('2025-01-16T09:00:00Z'),
  runCount: 0,
  createdAt: new Date('2025-01-15T10:00:00Z'),
  updatedAt: new Date('2025-01-15T10:00:00Z'),
};

const mockJob = {
  id: '223e4567-e89b-12d3-a456-426614174001',
  name: 'Test Schedule (manual trigger)',
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

describe('ScheduleService', () => {
  let service: ScheduleService;
  let mockScheduleRepository: {
    create: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    findByIdWithJobs: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    setEnabled: ReturnType<typeof vi.fn>;
  };
  let mockJobRepository: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateStatus: ReturnType<typeof vi.fn>;
  };
  let mockQueueManager: {
    enqueue: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockScheduleRepository = {
      create: vi.fn(),
      findById: vi.fn(),
      findByIdWithJobs: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      setEnabled: vi.fn(),
    };

    mockJobRepository = {
      create: vi.fn(),
      update: vi.fn(),
      updateStatus: vi.fn(),
    };

    mockQueueManager = {
      enqueue: vi.fn(),
    };

    service = new ScheduleService(
      mockScheduleRepository as unknown as ScheduleRepository,
      mockJobRepository as unknown as JobRepository,
      mockQueueManager as unknown as QueueManager
    );
  });

  describe('create', () => {
    it('should create a schedule with nextRunAt calculated', async () => {
      const input = {
        name: 'Test Schedule',
        cronExpr: '0 9 * * *',
        timezone: 'UTC',
        jobType: 'test.job',
        jobPayload: { key: 'value' },
        jobPriority: 'NORMAL' as const,
        enabled: true,
      };

      mockScheduleRepository.create.mockResolvedValue(mockSchedule);

      const result = await service.create(input);

      expect(mockScheduleRepository.create).toHaveBeenCalledWith(
        input,
        expect.any(Date) // nextRunAt should be calculated
      );
      expect(result).toEqual(mockSchedule);
    });

    it('should create a disabled schedule with null nextRunAt', async () => {
      const input = {
        name: 'Disabled Schedule',
        cronExpr: '0 9 * * *',
        timezone: 'UTC',
        jobType: 'test.job',
        jobPayload: {},
        jobPriority: 'NORMAL' as const,
        enabled: false,
      };

      const disabledSchedule = { ...mockSchedule, enabled: false, nextRunAt: null };
      mockScheduleRepository.create.mockResolvedValue(disabledSchedule);

      await service.create(input);

      expect(mockScheduleRepository.create).toHaveBeenCalledWith(input, null);
    });
  });

  describe('getById', () => {
    it('should return a schedule when found', async () => {
      mockScheduleRepository.findById.mockResolvedValue(mockSchedule);

      const result = await service.getById(mockSchedule.id);

      expect(result).toEqual(mockSchedule);
      expect(mockScheduleRepository.findById).toHaveBeenCalledWith(mockSchedule.id);
    });

    it('should throw NotFoundError when schedule not found', async () => {
      mockScheduleRepository.findById.mockResolvedValue(null);

      await expect(service.getById('non-existent-id')).rejects.toThrow(NotFoundError);
    });
  });

  describe('enable', () => {
    it('should enable a disabled schedule and calculate nextRunAt', async () => {
      const disabledSchedule = { ...mockSchedule, enabled: false, nextRunAt: null };
      mockScheduleRepository.findById.mockResolvedValue(disabledSchedule);
      mockScheduleRepository.setEnabled.mockResolvedValue({ ...mockSchedule, enabled: true });

      const result = await service.enable(mockSchedule.id);

      expect(mockScheduleRepository.setEnabled).toHaveBeenCalledWith(
        mockSchedule.id,
        true,
        expect.any(Date)
      );
      expect(result.enabled).toBe(true);
    });

    it('should throw BadRequestError when schedule is already enabled', async () => {
      mockScheduleRepository.findById.mockResolvedValue(mockSchedule);

      await expect(service.enable(mockSchedule.id)).rejects.toThrow(BadRequestError);
    });

    it('should throw NotFoundError when schedule not found', async () => {
      mockScheduleRepository.findById.mockResolvedValue(null);

      await expect(service.enable('non-existent-id')).rejects.toThrow(NotFoundError);
    });
  });

  describe('disable', () => {
    it('should disable an enabled schedule', async () => {
      mockScheduleRepository.findById.mockResolvedValue(mockSchedule);
      mockScheduleRepository.setEnabled.mockResolvedValue({
        ...mockSchedule,
        enabled: false,
        nextRunAt: null,
      });

      const result = await service.disable(mockSchedule.id);

      expect(mockScheduleRepository.setEnabled).toHaveBeenCalledWith(mockSchedule.id, false, null);
      expect(result.enabled).toBe(false);
    });

    it('should throw BadRequestError when schedule is already disabled', async () => {
      const disabledSchedule = { ...mockSchedule, enabled: false };
      mockScheduleRepository.findById.mockResolvedValue(disabledSchedule);

      await expect(service.disable(mockSchedule.id)).rejects.toThrow(BadRequestError);
    });
  });

  describe('trigger', () => {
    it('should create and enqueue a job from schedule', async () => {
      mockScheduleRepository.findById.mockResolvedValue(mockSchedule);
      mockJobRepository.create.mockResolvedValue(mockJob);
      mockJobRepository.update.mockResolvedValue(mockJob);
      mockJobRepository.updateStatus.mockResolvedValue({ ...mockJob, status: 'QUEUED' });
      mockQueueManager.enqueue.mockResolvedValue(undefined);

      const result = await service.trigger(mockSchedule.id);

      expect(mockJobRepository.create).toHaveBeenCalledWith({
        name: `${mockSchedule.name} (manual trigger)`,
        type: mockSchedule.jobType,
        payload: mockSchedule.jobPayload,
        priority: mockSchedule.jobPriority,
        maxRetries: 3,
        retryDelay: 1000,
      });
      expect(mockJobRepository.update).toHaveBeenCalledWith(mockJob.id, {
        scheduleId: mockSchedule.id,
      });
      expect(mockQueueManager.enqueue).toHaveBeenCalledWith(mockJob.id, mockJob.priority);
      expect(mockJobRepository.updateStatus).toHaveBeenCalledWith(mockJob.id, 'QUEUED');
      expect(result.status).toBe('QUEUED');
    });

    it('should throw NotFoundError when schedule not found', async () => {
      mockScheduleRepository.findById.mockResolvedValue(null);

      await expect(service.trigger('non-existent-id')).rejects.toThrow(NotFoundError);
    });
  });

  describe('getNextRuns', () => {
    it('should return next runs for enabled schedule', async () => {
      mockScheduleRepository.findById.mockResolvedValue(mockSchedule);

      const result = await service.getNextRuns(mockSchedule.id, 5);

      expect(result).toHaveLength(5);
      result.forEach((date) => {
        expect(date).toBeInstanceOf(Date);
      });
    });

    it('should return empty array for disabled schedule', async () => {
      const disabledSchedule = { ...mockSchedule, enabled: false };
      mockScheduleRepository.findById.mockResolvedValue(disabledSchedule);

      const result = await service.getNextRuns(mockSchedule.id, 5);

      expect(result).toEqual([]);
    });

    it('should throw NotFoundError when schedule not found', async () => {
      mockScheduleRepository.findById.mockResolvedValue(null);

      await expect(service.getNextRuns('non-existent-id', 5)).rejects.toThrow(NotFoundError);
    });
  });

  describe('update', () => {
    it('should recalculate nextRunAt when cronExpr changes', async () => {
      mockScheduleRepository.findById.mockResolvedValue(mockSchedule);
      mockScheduleRepository.update.mockResolvedValue(mockSchedule);

      await service.update(mockSchedule.id, { cronExpr: '0 10 * * *' });

      expect(mockScheduleRepository.update).toHaveBeenCalledWith(mockSchedule.id, {
        cronExpr: '0 10 * * *',
        nextRunAt: expect.any(Date),
      });
    });

    it('should recalculate nextRunAt when timezone changes', async () => {
      mockScheduleRepository.findById.mockResolvedValue(mockSchedule);
      mockScheduleRepository.update.mockResolvedValue(mockSchedule);

      await service.update(mockSchedule.id, { timezone: 'America/New_York' });

      expect(mockScheduleRepository.update).toHaveBeenCalledWith(mockSchedule.id, {
        timezone: 'America/New_York',
        nextRunAt: expect.any(Date),
      });
    });

    it('should set nextRunAt to null when disabling', async () => {
      mockScheduleRepository.findById.mockResolvedValue(mockSchedule);
      mockScheduleRepository.update.mockResolvedValue({ ...mockSchedule, enabled: false });

      await service.update(mockSchedule.id, { enabled: false });

      expect(mockScheduleRepository.update).toHaveBeenCalledWith(mockSchedule.id, {
        enabled: false,
        nextRunAt: null,
      });
    });

    it('should not recalculate nextRunAt for non-cron updates', async () => {
      mockScheduleRepository.findById.mockResolvedValue(mockSchedule);
      mockScheduleRepository.update.mockResolvedValue(mockSchedule);

      await service.update(mockSchedule.id, { name: 'New Name' });

      expect(mockScheduleRepository.update).toHaveBeenCalledWith(mockSchedule.id, {
        name: 'New Name',
      });
    });
  });

  describe('delete', () => {
    it('should delete a schedule', async () => {
      mockScheduleRepository.findById.mockResolvedValue(mockSchedule);
      mockScheduleRepository.delete.mockResolvedValue(mockSchedule);

      await service.delete(mockSchedule.id);

      expect(mockScheduleRepository.delete).toHaveBeenCalledWith(mockSchedule.id);
    });

    it('should throw NotFoundError when schedule not found', async () => {
      mockScheduleRepository.findById.mockResolvedValue(null);

      await expect(service.delete('non-existent-id')).rejects.toThrow(NotFoundError);
    });
  });
});
