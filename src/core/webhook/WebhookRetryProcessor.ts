import type { WebhookEventRepository } from '../../repositories/webhook-event.repository.js';
import type { WebhookDispatcher, WebhookPayload } from './WebhookDispatcher.js';
import type { Logger } from '../../infrastructure/index.js';

export interface WebhookRetryConfig {
  checkIntervalMs: number; // Intervalo entre chequeos (default: 30s)
  batchSize: number; // Webhooks a procesar por ciclo (default: 50)
  baseDelayMs: number; // Delay base para backoff (default: 5s)
  multiplier: number; // Multiplicador de backoff (default: 2)
}

const DEFAULT_CONFIG: WebhookRetryConfig = {
  checkIntervalMs: 30000, // 30 segundos
  batchSize: 50,
  baseDelayMs: 5000,
  multiplier: 2,
};

export class WebhookRetryProcessor {
  private config: WebhookRetryConfig;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly webhookEventRepository: WebhookEventRepository,
    private readonly webhookDispatcher: WebhookDispatcher,
    private readonly logger: Logger,
    config?: Partial<WebhookRetryConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Inicia el procesador de reintentos
   */
  start(): void {
    if (this.running) {
      this.logger.warn('WebhookRetryProcessor already running');
      return;
    }

    this.running = true;
    this.logger.info(
      { checkIntervalMs: this.config.checkIntervalMs, batchSize: this.config.batchSize },
      'WebhookRetryProcessor started'
    );

    this.timer = setInterval(() => {
      void this.processRetries();
    }, this.config.checkIntervalMs);
  }

  /**
   * Detiene el procesador de reintentos
   */
  stop(): void {
    if (!this.running) return;

    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.logger.info('WebhookRetryProcessor stopped');
  }

  /**
   * Procesa un lote de webhooks pendientes de reintento
   */
  async processRetries(): Promise<number> {
    try {
      // Buscar webhooks pendientes que necesitan reintento
      const pendingEvents = await this.webhookEventRepository.findPendingRetries(
        this.config.batchSize
      );

      if (pendingEvents.length === 0) {
        return 0;
      }

      this.logger.debug({ count: pendingEvents.length }, 'Processing webhook retries');

      let successCount = 0;

      for (const event of pendingEvents) {
        // Calcular si ya pasó suficiente tiempo para reintentar
        const shouldRetry = this.shouldRetry(event.attempts, event.lastAttemptAt);

        if (!shouldRetry) {
          continue;
        }

        // Incrementar attempts antes de intentar
        await this.webhookEventRepository.updateAttempt(event.id, {
          status: 'retrying',
          attempts: event.attempts + 1,
        });

        const payload = event.payload as unknown as WebhookPayload;
        const success = await this.webhookDispatcher.executeWebhook(event.id, event.url, payload);

        if (success) {
          successCount++;
        }
      }

      if (successCount > 0) {
        this.logger.info({ successCount, total: pendingEvents.length }, 'Webhook retries processed');
      }

      return successCount;
    } catch (error) {
      this.logger.error({ error }, 'Error processing webhook retries');
      return 0;
    }
  }

  /**
   * Determina si un webhook debería reintentarse basado en backoff exponencial
   */
  private shouldRetry(attempts: number, lastAttemptAt: Date | null): boolean {
    if (!lastAttemptAt) {
      return true; // Nunca se intentó
    }

    // Calcular delay con backoff exponencial
    const delay = this.config.baseDelayMs * Math.pow(this.config.multiplier, attempts);
    const nextAttemptTime = lastAttemptAt.getTime() + delay;

    return Date.now() >= nextAttemptTime;
  }
}
