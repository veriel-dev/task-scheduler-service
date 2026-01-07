import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebhookDispatcher } from '../WebhookDispatcher.js';
import type { WebhookEventRepository } from '../../../repositories/webhook-event.repository.js';
import type { Logger } from '../../../infrastructure/index.js';
import type { Job } from '@prisma/client';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockJob: Job = {
  id: 'job-123',
  name: 'Test Job',
  type: 'test.job',
  payload: { key: 'value' },
  status: 'COMPLETED',
  priority: 'NORMAL',
  maxRetries: 3,
  retryCount: 0,
  retryDelay: 1000,
  scheduledAt: null,
  webhookUrl: 'https://example.com/webhook',
  workerId: 'worker-123',
  scheduleId: null,
  result: { success: true },
  error: null,
  startedAt: new Date(),
  completedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockWebhookEvent = {
  id: 'event-123',
  jobId: 'job-123',
  jobType: 'test.job',
  url: 'https://example.com/webhook',
  payload: {},
  status: 'pending',
  attempts: 0,
  maxAttempts: 3,
  lastStatusCode: null,
  lastError: null,
  lastAttemptAt: null,
  createdAt: new Date(),
  completedAt: null,
};

describe('WebhookDispatcher', () => {
  let dispatcher: WebhookDispatcher;
  let mockWebhookEventRepository: {
    create: ReturnType<typeof vi.fn>;
    markSuccess: ReturnType<typeof vi.fn>;
    markFailed: ReturnType<typeof vi.fn>;
  };
  let mockLogger: Logger;

  beforeEach(() => {
    vi.useFakeTimers();

    mockWebhookEventRepository = {
      create: vi.fn(),
      markSuccess: vi.fn(),
      markFailed: vi.fn(),
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

    dispatcher = new WebhookDispatcher(
      mockWebhookEventRepository as unknown as WebhookEventRepository,
      mockLogger,
      { timeoutMs: 5000, maxAttempts: 3 }
    );

    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('dispatch', () => {
    it('should not dispatch if no webhookUrl', async () => {
      const jobWithoutWebhook = { ...mockJob, webhookUrl: null };

      await dispatcher.dispatch(jobWithoutWebhook, 'completed', { result: 'ok' });

      expect(mockWebhookEventRepository.create).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should create webhook event and send request', async () => {
      mockWebhookEventRepository.create.mockResolvedValue(mockWebhookEvent);
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      });
      mockWebhookEventRepository.markSuccess.mockResolvedValue(mockWebhookEvent);

      await dispatcher.dispatch(mockJob, 'completed', { result: 'ok' });

      expect(mockWebhookEventRepository.create).toHaveBeenCalledWith({
        jobId: mockJob.id,
        jobType: mockJob.type,
        url: mockJob.webhookUrl,
        payload: expect.objectContaining({
          jobId: mockJob.id,
          jobType: mockJob.type,
          status: 'completed',
          result: { result: 'ok' },
        }),
        maxAttempts: 3,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        mockJob.webhookUrl,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should dispatch failed status with error', async () => {
      mockWebhookEventRepository.create.mockResolvedValue(mockWebhookEvent);
      mockFetch.mockResolvedValue({ ok: true, status: 200 });
      mockWebhookEventRepository.markSuccess.mockResolvedValue(mockWebhookEvent);

      await dispatcher.dispatch(mockJob, 'failed', undefined, 'Job failed');

      expect(mockWebhookEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            status: 'failed',
            error: 'Job failed',
          }),
        })
      );
    });
  });

  describe('executeWebhook', () => {
    const payload = {
      jobId: 'job-123',
      jobType: 'test.job',
      status: 'completed' as const,
      result: { ok: true },
      error: undefined,
      completedAt: new Date().toISOString(),
    };

    it('should return true and mark success on 2xx response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      });
      mockWebhookEventRepository.markSuccess.mockResolvedValue(mockWebhookEvent);

      const result = await dispatcher.executeWebhook('event-123', 'https://example.com/webhook', payload);

      expect(result).toBe(true);
      expect(mockWebhookEventRepository.markSuccess).toHaveBeenCalledWith('event-123', 200);
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should return false and mark failed on non-2xx response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });
      mockWebhookEventRepository.markFailed.mockResolvedValue(mockWebhookEvent);

      const result = await dispatcher.executeWebhook('event-123', 'https://example.com/webhook', payload);

      expect(result).toBe(false);
      expect(mockWebhookEventRepository.markFailed).toHaveBeenCalledWith(
        'event-123',
        'HTTP 500: Internal Server Error',
        500
      );
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should return false and mark failed on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));
      mockWebhookEventRepository.markFailed.mockResolvedValue(mockWebhookEvent);

      const result = await dispatcher.executeWebhook('event-123', 'https://example.com/webhook', payload);

      expect(result).toBe(false);
      expect(mockWebhookEventRepository.markFailed).toHaveBeenCalledWith('event-123', 'Network error');
    });

    it('should handle timeout with AbortError', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);
      mockWebhookEventRepository.markFailed.mockResolvedValue(mockWebhookEvent);

      const result = await dispatcher.executeWebhook('event-123', 'https://example.com/webhook', payload);

      expect(result).toBe(false);
      expect(mockWebhookEventRepository.markFailed).toHaveBeenCalledWith('event-123', 'Request timeout');
    });

    it('should include correct headers', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });
      mockWebhookEventRepository.markSuccess.mockResolvedValue(mockWebhookEvent);

      await dispatcher.executeWebhook('event-123', 'https://example.com/webhook', payload);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Event': 'job.status',
            'X-Job-Id': 'job-123',
          },
        })
      );
    });
  });
});
