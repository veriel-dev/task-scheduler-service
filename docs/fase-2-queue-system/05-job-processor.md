# JobProcessor

## Descripción

El JobProcessor ejecuta jobs individuales, maneja reintentos con backoff exponencial y dispara webhooks.

**Archivo:** `src/core/worker/JobProcessor.ts`

## Handlers

```typescript
export type JobHandler = (job: Job) => Promise<unknown>;

// Registro de handlers
private handlers: Map<string, JobHandler> = new Map();

registerHandler(jobType: string, handler: JobHandler): void {
  this.handlers.set(jobType, handler);
  this.logger.info({ jobType }, 'Handler registered');
}
```

**Uso:**

```typescript
// En worker.ts, antes de start()
container.jobProcessor.registerHandler('email.send', async (job) => {
  const { to, subject, body } = job.payload as EmailPayload;
  await sendEmail(to, subject, body);
  return { sent: true };
});

container.jobProcessor.registerHandler('report.generate', async (job) => {
  const report = await generateReport(job.payload);
  return { reportId: report.id };
});
```

## Flujo de Procesamiento

```typescript
async process(job: Job, workerId: string): Promise<JobResult> {
  // 1. Buscar handler
  const handler = this.handlers.get(job.type);

  if (!handler) {
    await this.handleFailure(job, `No handler for: ${job.type}`);
    return { success: false, error: 'No handler' };
  }

  // 2. Transición: QUEUED → PROCESSING
  await this.jobRepository.updateInternal(job.id, {
    status: 'PROCESSING',
    startedAt: new Date(),
    workerId,
  });
  await this.queueManager.markProcessing(job.id, workerId);

  try {
    // 3. Ejecutar handler
    const result = await handler(job);

    // 4a. Éxito
    await this.handleSuccess(job, result);
    return { success: true, result };

  } catch (error) {
    // 4b. Error
    const message = error instanceof Error ? error.message : String(error);
    await this.handleError(job, message);
    return { success: false, error: message };
  }
}
```

## Manejo de Éxito

```typescript
private async handleSuccess(job: Job, result: unknown): Promise<void> {
  // Actualizar BD
  await this.jobRepository.updateInternal(job.id, {
    status: 'COMPLETED',
    result: result as object,
    completedAt: new Date(),
  });

  // Limpiar Redis
  await this.queueManager.markCompleted(job.id);

  this.logger.info({ jobId: job.id }, 'Job completed');

  // Webhook (fire and forget)
  if (job.webhookUrl) {
    await this.triggerWebhook(job, 'completed', result);
  }
}
```

## Manejo de Errores

```typescript
private async handleError(job: Job, errorMessage: string): Promise<void> {
  const maxRetries = job.maxRetries;
  const currentRetry = job.retryCount;

  this.logger.warn({
    jobId: job.id,
    error: errorMessage,
    retryCount: currentRetry,
    maxRetries,
  }, 'Job failed');

  if (currentRetry < maxRetries) {
    // Reintentar
    await this.scheduleRetry(job, currentRetry + 1, errorMessage);
  } else {
    // Fallo definitivo
    await this.handleFailure(job, errorMessage);
  }
}
```

## Backoff Exponencial

```typescript
interface RetryConfig {
  maxRetries: number;   // 3
  baseDelay: number;    // 1000ms
  maxDelay: number;     // 60000ms
  multiplier: number;   // 2
}

private calculateRetryDelay(retryCount: number, baseDelay: number): number {
  const delay = baseDelay * Math.pow(this.retryConfig.multiplier, retryCount);
  return Math.min(delay, this.retryConfig.maxDelay);
}
```

**Ejemplo:**
```
Intento 1: 1000 * 2^0 = 1000ms  (1s)
Intento 2: 1000 * 2^1 = 2000ms  (2s)
Intento 3: 1000 * 2^2 = 4000ms  (4s)
Intento 4: 1000 * 2^3 = 8000ms  (8s)
...
Máximo: 60000ms (60s)
```

## Schedule Retry

```typescript
private async scheduleRetry(
  job: Job,
  retryCount: number,
  errorMessage: string
): Promise<void> {
  const baseDelay = job.retryDelay;
  const delay = this.calculateRetryDelay(retryCount - 1, baseDelay);

  // Actualizar BD
  await this.jobRepository.updateInternal(job.id, {
    status: 'RETRYING',
    retryCount,
    error: errorMessage,
  });

  // Re-encolar con delay
  await this.queueManager.requeue(job.id, job.priority, delay);

  this.logger.info({ jobId: job.id, retryCount, delayMs: delay }, 'Retry scheduled');
}
```

## Fallo Definitivo

```typescript
private async handleFailure(job: Job, errorMessage: string): Promise<void> {
  // Actualizar BD
  await this.jobRepository.updateInternal(job.id, {
    status: 'FAILED',
    error: errorMessage,
    completedAt: new Date(),
  });

  // Mover a DLQ
  await this.queueManager.moveToDLQ(job.id, errorMessage);

  this.logger.error({ jobId: job.id, error: errorMessage }, 'Job failed permanently');

  // Webhook
  if (job.webhookUrl) {
    await this.triggerWebhook(job, 'failed', null, errorMessage);
  }
}
```

## Webhooks

```typescript
private async triggerWebhook(
  job: Job,
  status: 'completed' | 'failed',
  result?: unknown,
  error?: string
): Promise<void> {
  if (!job.webhookUrl) return;

  try {
    const response = await fetch(job.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId: job.id,
        jobType: job.type,
        status,
        result,
        error,
        completedAt: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      this.logger.warn({ jobId: job.id, status: response.status }, 'Webhook failed');
    }
  } catch (err) {
    this.logger.warn({ jobId: job.id, error: err }, 'Webhook error');
  }
}
```

**Características:**
- Fire and forget: no bloquea
- Sin reintentos: falla silenciosamente
- No afecta el estado del job
