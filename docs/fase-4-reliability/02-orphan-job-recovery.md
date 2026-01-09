# Orphan Job Recovery

## Proposito

Cuando un worker muere inesperadamente (crash, OOM, red caida), los jobs que estaba procesando quedan "huerfanos" en estado PROCESSING. OrphanJobRecovery detecta y recupera estos jobs automaticamente.

## Problema

```
Worker-1 toma Job-A
    │
    ▼
Job-A.status = PROCESSING
Job-A.workerId = Worker-1
    │
    ▼
Worker-1 crashea (OOM, SIGKILL, red)
    │
    ▼
Job-A queda en PROCESSING para siempre
(sin heartbeat, sin worker)
```

## Solucion

OrphanJobRecovery ejecuta periodicamente:

1. Busca workers con `lastHeartbeat > threshold`
2. Para cada worker stale, busca sus jobs en PROCESSING
3. Re-encola los jobs con delay
4. Marca el worker como stopped

## Configuracion

```typescript
interface OrphanRecoveryConfig {
  checkIntervalMs: number;    // Default: 60000 (60 segundos)
  staleThresholdMs: number;   // Default: 90000 (90 segundos)
  recoveryDelayMs: number;    // Default: 5000 (5 segundos)
}
```

Variables de entorno:

```bash
ORPHAN_CHECK_INTERVAL_MS=60000    # Verificar cada 60 segundos
ORPHAN_STALE_THRESHOLD_MS=90000   # Worker stale si heartbeat > 90s
```

## Flujo de Recuperacion

```
┌─────────────────────────────────────────────────────────────────┐
│                    OrphanJobRecovery.recover()                   │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │ workerRepository       │
              │ .findStaleWorkers(90s) │
              └───────────┬────────────┘
                          │
                ┌─────────┴─────────┐
                │                   │
            Sin workers        Workers encontrados
                │                   │
                ▼                   ▼
        return { 0, 0 }    Para cada stale worker:
                                    │
                           ┌────────┴────────┐
                           │                 │
                           ▼                 │
              ┌─────────────────────┐        │
              │ jobRepository       │        │
              │ .findMany({         │        │
              │   workerId,         │        │
              │   status: PROCESSING│        │
              │ })                  │        │
              └─────────┬───────────┘        │
                        │                    │
                        ▼                    │
              Para cada job huerfano:        │
                        │                    │
              ┌─────────┴─────────┐          │
              │                   │          │
              ▼                   ▼          │
      ┌─────────────┐     ┌─────────────┐    │
      │ jobRepo     │     │ queueManager│    │
      │ .update({   │     │ .markComplete│   │
      │   status:   │     │ .requeue()  │    │
      │   RETRYING, │     └─────────────┘    │
      │   retryCount│                        │
      │   ++        │                        │
      │ })          │                        │
      └─────────────┘                        │
                                             │
                           ┌─────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │ workerRepository       │
              │ .stop(workerId)        │
              └────────────────────────┘
```

## Implementacion

```typescript
// src/core/worker/OrphanJobRecovery.ts

export class OrphanJobRecovery {
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly workerRepository: WorkerRepository,
    private readonly queueManager: QueueManager,
    private readonly logger: Logger,
    private readonly config: OrphanRecoveryConfig
  ) {}

  start(): void {
    if (this.intervalId) {
      this.logger.warn('OrphanJobRecovery already running');
      return;
    }

    this.logger.info(
      { interval: this.config.checkIntervalMs },
      'Starting OrphanJobRecovery'
    );

    // Ejecutar inmediatamente y luego periodicamente
    void this.recover();
    this.intervalId = setInterval(
      () => void this.recover(),
      this.config.checkIntervalMs
    );
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.info('OrphanJobRecovery stopped');
    }
  }

  async recover(): Promise<{ staleWorkers: number; orphanJobs: number }> {
    try {
      // 1. Buscar workers stale
      const staleWorkers = await this.workerRepository.findStaleWorkers(
        this.config.staleThresholdMs
      );

      if (staleWorkers.length === 0) {
        return { staleWorkers: 0, orphanJobs: 0 };
      }

      this.logger.info(
        { count: staleWorkers.length },
        'Found stale workers'
      );

      let totalOrphanJobs = 0;

      // 2. Para cada worker stale
      for (const worker of staleWorkers) {
        const orphanJobs = await this.recoverWorkerJobs(worker);
        totalOrphanJobs += orphanJobs;

        // 3. Marcar worker como stopped
        await this.workerRepository.stop(worker.id);
      }

      return { staleWorkers: staleWorkers.length, orphanJobs: totalOrphanJobs };
    } catch (error) {
      this.logger.error({ error }, 'Error in OrphanJobRecovery');
      return { staleWorkers: 0, orphanJobs: 0 };
    }
  }

  private async recoverWorkerJobs(worker: Worker): Promise<number> {
    // Buscar jobs en PROCESSING asignados a este worker
    const result = await this.jobRepository.findMany({
      workerId: worker.id,
      status: 'PROCESSING',
      page: 1,
      limit: 100,
    });

    for (const job of result.data) {
      // Actualizar job
      await this.jobRepository.update(job.id, {
        status: 'RETRYING',
        retryCount: job.retryCount + 1,
        error: 'Worker died - job recovered automatically',
        workerId: null,
      });

      // Limpiar de Redis processing y re-encolar
      await this.queueManager.markCompleted(job.id);
      await this.queueManager.requeue(
        job.id,
        job.priority,
        this.config.recoveryDelayMs
      );

      this.logger.info(
        { jobId: job.id, workerId: worker.id },
        'Recovered orphan job'
      );
    }

    return result.data.length;
  }
}
```

## Integracion con Worker

```typescript
// src/worker.ts

async function main() {
  const container = await createContainer();

  // Iniciar OrphanJobRecovery
  container.orphanJobRecovery.start();

  // ... resto del worker

  // Cleanup
  process.on('SIGTERM', async () => {
    container.orphanJobRecovery.stop();
    // ... cleanup
  });
}
```

## Garantias

| Garantia | Descripcion |
|----------|-------------|
| Atomicidad | Cada job se recupera independientemente |
| Idempotencia | Multiples ejecuciones no duplican jobs |
| Backpressure | Delay configurable antes de re-procesar |
| Logging | Cada recuperacion se registra |

## Archivos Relacionados

| Archivo | Descripcion |
|---------|-------------|
| `src/core/worker/OrphanJobRecovery.ts` | Logica de recuperacion |
| `src/worker.ts` | Inicializacion |
| `src/repositories/worker.repository.ts` | findStaleWorkers() |

## Tests

```bash
pnpm test OrphanJobRecovery.test
```

Cobertura:
- recover() sin workers stale
- recover() con workers stale y jobs huerfanos
- recover() con multiples workers
- start/stop del intervalo
- Manejo de errores
