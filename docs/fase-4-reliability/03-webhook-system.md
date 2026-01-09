# Webhook System

## Proposito

Notificar a sistemas externos cuando un job se completa o falla, permitiendo integraciones sin polling.

## Componentes

| Componente | Descripcion |
|------------|-------------|
| WebhookDispatcher | Envia webhooks y registra eventos |
| WebhookRetryProcessor | Procesa reintentos con backoff |
| WebhookEventRepository | Persistencia de eventos |

## Flujo de Webhook

```
Job completa o falla
         │
         ▼
┌─────────────────────────┐
│   JobProcessor          │
│   handleSuccess/Failure │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   WebhookDispatcher     │
│   dispatch()            │
└───────────┬─────────────┘
            │
    ┌───────┴───────┐
    │               │
    ▼               ▼
┌─────────────┐ ┌─────────────┐
│ Crear       │ │ Ejecutar    │
│ WebhookEvent│ │ HTTP POST   │
│ en BD       │ │             │
└─────────────┘ └──────┬──────┘
                       │
              ┌────────┴────────┐
              │                 │
           Success           Failure
              │                 │
              ▼                 ▼
      ┌─────────────┐   ┌─────────────┐
      │ markSuccess │   │ markFailed  │
      │ (status=    │   │ (attempts++)│
      │  success)   │   │             │
      └─────────────┘   └──────┬──────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ WebhookRetryProcessor│
                    │ (procesa pendientes) │
                    └─────────────────────┘
```

## Configuracion

```typescript
interface WebhookConfig {
  timeoutMs: number;      // Default: 10000 (10 segundos)
  maxAttempts: number;    // Default: 3
}

interface RetryConfig {
  retryIntervalMs: number;  // Default: 30000 (30 segundos)
  baseDelayMs: number;      // Default: 1000 (1 segundo)
  maxDelayMs: number;       // Default: 300000 (5 minutos)
}
```

Variables de entorno:

```bash
WEBHOOK_TIMEOUT_MS=10000          # Timeout de request
WEBHOOK_MAX_ATTEMPTS=3            # Intentos maximos
WEBHOOK_RETRY_INTERVAL_MS=30000   # Intervalo de verificacion
```

## Payload de Webhook

```json
{
  "jobId": "uuid",
  "jobType": "email.send",
  "status": "completed",
  "result": { "sent": true, "messageId": "abc123" },
  "error": null,
  "completedAt": "2025-01-15T10:30:00.000Z"
}
```

### Headers

```
Content-Type: application/json
X-Webhook-Event: job.status
X-Job-Id: <job-id>
```

## Modelo de Datos

```prisma
model WebhookEvent {
  id             String    @id @default(uuid())
  jobId          String
  jobType        String
  url            String
  payload        Json
  status         String    @default("pending")  // pending, success, failed
  attempts       Int       @default(0)
  maxAttempts    Int       @default(3)
  lastStatusCode Int?
  lastError      String?
  lastAttemptAt  DateTime?
  createdAt      DateTime  @default(now())
  completedAt    DateTime?

  @@index([status])
  @@index([jobId])
  @@map("webhook_events")
}
```

## WebhookDispatcher

```typescript
// src/core/webhook/WebhookDispatcher.ts

export class WebhookDispatcher {
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

  async executeWebhook(
    eventId: string,
    url: string,
    payload: WebhookPayload
  ): Promise<boolean> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.config.timeoutMs);

    try {
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
        return true;
      } else {
        const errorMsg = `HTTP ${response.status}: ${response.statusText}`;
        await this.webhookEventRepository.markFailed(eventId, errorMsg, response.status);
        return false;
      }
    } catch (err) {
      clearTimeout(timeoutId);
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      const errorMsg = isTimeout ? 'Request timeout' : (err as Error).message;
      await this.webhookEventRepository.markFailed(eventId, errorMsg);
      return false;
    }
  }
}
```

## WebhookRetryProcessor

```typescript
// src/core/webhook/WebhookRetryProcessor.ts

export class WebhookRetryProcessor {
  start(): void {
    this.intervalId = setInterval(
      () => void this.processRetries(),
      this.config.retryIntervalMs
    );
  }

  async processRetries(): Promise<number> {
    // Buscar eventos pendientes donde attempts < maxAttempts
    const events = await this.webhookEventRepository.findPendingRetries();

    let processed = 0;
    for (const event of events) {
      // Verificar backoff
      const delay = this.calculateBackoff(event.attempts);
      const nextAttemptAt = new Date(event.lastAttemptAt!.getTime() + delay);

      if (nextAttemptAt <= new Date()) {
        const success = await this.webhookDispatcher.executeWebhook(
          event.id,
          event.url,
          event.payload as WebhookPayload
        );

        if (success) {
          processed++;
        }
      }
    }

    return processed;
  }

  private calculateBackoff(attempts: number): number {
    // Backoff exponencial: 1s, 2s, 4s, 8s, ... (max 5 min)
    const delay = this.config.baseDelayMs * Math.pow(2, attempts);
    return Math.min(delay, this.config.maxDelayMs);
  }
}
```

## Backoff Exponencial

| Intento | Delay |
|---------|-------|
| 1 | 1 segundo |
| 2 | 2 segundos |
| 3 | 4 segundos |
| 4 | 8 segundos |
| 5 | 16 segundos |
| ... | ... |
| n | min(1s * 2^n, 5 min) |

## Integracion con JobProcessor

```typescript
// src/core/worker/JobProcessor.ts

async handleSuccess(job: Job, result: unknown): Promise<void> {
  await this.jobRepository.update(job.id, {
    status: 'COMPLETED',
    result: result as JsonValue,
    completedAt: new Date(),
  });

  await this.queueManager.markCompleted(job.id);

  // Disparar webhook
  await this.webhookDispatcher.dispatch(job, 'completed', result);
}

async handleFailure(job: Job, error: Error): Promise<void> {
  // ... logica de reintentos o DLQ ...

  // Disparar webhook si va a DLQ
  if (job.retryCount >= job.maxRetries) {
    await this.webhookDispatcher.dispatch(job, 'failed', undefined, error.message);
  }
}
```

## Archivos Relacionados

| Archivo | Descripcion |
|---------|-------------|
| `src/core/webhook/WebhookDispatcher.ts` | Envio de webhooks |
| `src/core/webhook/WebhookRetryProcessor.ts` | Reintentos |
| `src/repositories/webhook-event.repository.ts` | Persistencia |
| `src/core/worker/JobProcessor.ts` | Integracion |

## Tests

```bash
pnpm test WebhookDispatcher.test
```

Cobertura:
- dispatch() sin webhookUrl
- dispatch() con exito
- dispatch() con fallo HTTP
- dispatch() con timeout
- Headers correctos
- Backoff exponencial
