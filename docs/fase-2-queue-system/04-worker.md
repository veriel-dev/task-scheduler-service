# Worker

## Descripción

El Worker es un proceso daemon que consume jobs de la cola y los ejecuta.

**Archivo:** `src/core/worker/Worker.ts`

## Configuración

```typescript
interface WorkerConfig {
  name: string;              // Identificador (ej: "worker-12345")
  concurrency: number;       // Jobs paralelos (actual: 1)
  pollIntervalMs: number;    // Espera si cola vacía (1000ms)
  heartbeatIntervalMs: number; // Heartbeat a BD (30000ms)
  promoteIntervalMs: number; // Promover delayed (5000ms)
}

const DEFAULT_CONFIG: WorkerConfig = {
  name: 'worker',
  concurrency: 1,
  pollIntervalMs: 1000,
  heartbeatIntervalMs: 30000,
  promoteIntervalMs: 5000,
};
```

## Lifecycle

```
┌─────────────────────────────────────────────────────────┐
│ 1. start()                                              │
│    ├─ Registrar en PostgreSQL (workers table)          │
│    ├─ Iniciar heartbeat timer (cada 30s)               │
│    ├─ Iniciar delayed promoter (cada 5s)               │
│    ├─ Registrar signal handlers (SIGTERM, SIGINT)      │
│    └─ Iniciar loop principal                           │
└─────────────────────────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   Heartbeat      Delayed Promo      Main Loop
   (30s)          (5s)               (continuo)
        │                │                │
        └────────────────┼────────────────┘
                         │
                    [SIGTERM]
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│ 2. stop()                                               │
│    ├─ running = false (detiene loop)                   │
│    ├─ Limpiar timers                                   │
│    ├─ Marcar stopped en BD                             │
│    └─ exit(0)                                          │
└─────────────────────────────────────────────────────────┘
```

## Main Loop

```typescript
private async loop(): Promise<void> {
  while (this.running) {
    try {
      // 1. Obtener siguiente job
      const jobId = await this.queueManager.dequeue();

      if (!jobId) {
        // Cola vacía, esperar
        await this.sleep(this.config.pollIntervalMs);
        continue;
      }

      // 2. Cargar job de BD
      const job = await this.jobRepository.findById(jobId);

      if (!job) {
        this.logger.warn({ jobId }, 'Job not found');
        continue;
      }

      // 3. Validar estado
      if (!this.isProcessableStatus(job.status)) {
        this.logger.warn({ jobId, status: job.status }, 'Not processable');
        continue;
      }

      // 4. Procesar
      await this.processJob(job);

    } catch (error) {
      this.logger.error({ error }, 'Error in loop');
      await this.sleep(this.config.pollIntervalMs);
    }
  }
}
```

## Heartbeat

```typescript
private startHeartbeat(): void {
  this.heartbeatTimer = setInterval(async () => {
    if (this.workerId) {
      try {
        await this.workerRepository.updateHeartbeat(this.workerId);
        this.logger.debug({ workerId: this.workerId }, 'Heartbeat sent');
      } catch (error) {
        this.logger.error({ error }, 'Heartbeat failed');
      }
    }
  }, this.config.heartbeatIntervalMs);
}
```

**Propósito:**
- Actualiza `workers.lastHeartbeat` cada 30s
- Permite detectar workers muertos (sin heartbeat > umbral)
- Fire and forget: no bloquea si falla

## Signal Handlers

```typescript
private registerSignalHandlers(): void {
  const shutdown = async (signal: string) => {
    this.logger.info({ signal }, 'Received shutdown signal');
    await this.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}
```

**Manejo:**
- `SIGTERM`: Docker, systemd, kill
- `SIGINT`: Ctrl+C
- Graceful: termina job actual, actualiza BD, sale limpio

## Estados Procesables

```typescript
private isProcessableStatus(status: string): boolean {
  return ['QUEUED', 'RETRYING'].includes(status);
}
```

Solo procesa jobs en QUEUED o RETRYING.

## Estadísticas

```typescript
private async processJob(job: Job): Promise<void> {
  if (!this.workerId) return;

  // Marcar activo
  await this.workerRepository.setActiveJobs(this.workerId, 1);

  try {
    const result = await this.jobProcessor.process(job, this.workerId);

    // Actualizar contadores
    if (result.success) {
      await this.workerRepository.incrementProcessed(this.workerId);
    } else {
      await this.workerRepository.incrementFailed(this.workerId);
    }
  } finally {
    // Marcar inactivo
    await this.workerRepository.setActiveJobs(this.workerId, 0);
  }
}
```

## Uso

```typescript
// src/worker.ts
import { createContainer } from './container.js';
import { Worker } from './core/worker/index.js';

const container = await createContainer();

const worker = new Worker(
  container.jobRepository,
  container.workerRepository,
  container.queueManager,
  container.jobProcessor,
  container.logger,
  {
    name: `worker-${process.pid}`,
    concurrency: 1,
  }
);

await worker.start();
```

```bash
# Iniciar
pnpm worker

# Múltiples workers
pnpm worker &
pnpm worker &
```
