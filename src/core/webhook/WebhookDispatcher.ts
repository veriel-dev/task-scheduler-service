import type { Job } from '@prisma/client';
import type { WebhookEventRepository } from '../../repositories/webhook-event.repository.js';
import type { Logger } from '../../infrastructure/index.js';

export interface WebhookConfig {
  timeoutMs: number;
  maxAttempts: number;
}

export interface WebhookPayload {
  jobId: string;
  jobType: string;
  status: 'completed' | 'failed';
  result?: unknown;
  error?: string;
  completedAt: string;
}

const DEFAULT_CONFIG: WebhookConfig = {
  timeoutMs: 10000, // 10 seconds
  maxAttempts: 3,
};

export class WebhookDispatcher {
  private config: WebhookConfig;

  constructor(
    private readonly webhookEventRepository: WebhookEventRepository,
    private readonly logger: Logger,
    config?: Partial<WebhookConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Dispara un webhook para un job completado o fallido.
   * Crea un registro en BD y ejecuta el primer intento.
   */
  async dispatch(
    job: Job,
    status: 'completed' | 'failed',
    result?: unknown,
    error?: string
  ): Promise<void> {
    if (!job.webhookUrl) return;

    const payload: WebhookPayload = {
      jobId: job.id,
      jobType: job.type,
      status,
      result,
      error,
      completedAt: new Date().toISOString(),
    };

    // Crear registro en BD para tracking
    const webhookEvent = await this.webhookEventRepository.create({
      jobId: job.id,
      jobType: job.type,
      url: job.webhookUrl,
      payload: payload as Record<string, unknown>,
      maxAttempts: this.config.maxAttempts,
    });

    // Ejecutar primer intento inmediatamente
    await this.executeWebhook(webhookEvent.id, job.webhookUrl, payload);
  }

  /**
   * Ejecuta un intento de envío de webhook
   */
  async executeWebhook(eventId: string, url: string, payload: WebhookPayload): Promise<boolean> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.config.timeoutMs);

    try {
      this.logger.debug({ eventId, url, jobId: payload.jobId }, 'Sending webhook');

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Event': 'job.status',
          'X-Job-Id': payload.jobId,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        await this.webhookEventRepository.markSuccess(eventId, response.status);
        this.logger.info(
          { eventId, url, statusCode: response.status, jobId: payload.jobId },
          'Webhook sent successfully'
        );
        return true;
      } else {
        const errorMsg = `HTTP ${String(response.status)}: ${response.statusText}`;
        await this.webhookEventRepository.markFailed(eventId, errorMsg, response.status);
        this.logger.warn(
          { eventId, url, statusCode: response.status, jobId: payload.jobId },
          'Webhook failed with non-2xx status'
        );
        return false;
      }
    } catch (err) {
      clearTimeout(timeoutId);

      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      const isTimeout = err instanceof Error && err.name === 'AbortError';

      await this.webhookEventRepository.markFailed(
        eventId,
        isTimeout ? 'Request timeout' : errorMsg
      );

      this.logger.warn(
        { eventId, url, error: errorMsg, jobId: payload.jobId, isTimeout },
        'Webhook request failed'
      );
      return false;
    }
  }
}
