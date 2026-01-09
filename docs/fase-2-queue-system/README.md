# Fase 2: Queue System

Esta documentación describe la implementación del sistema de colas del Task Scheduler Service.

## Contenido

1. [QueueManager](./01-queue-manager.md)
2. [Priority Queue](./02-priority-queue.md)
3. [Delayed Queue](./03-delayed-queue.md)
4. [Worker](./04-worker.md)
5. [JobProcessor](./05-job-processor.md)
6. [Flujo Completo](./06-flujo-completo.md)

## Resumen

La Fase 2 implementa el sistema de colas distribuido:

| Componente | Descripción | Estado |
|------------|-------------|--------|
| QueueManager | Abstracción sobre Redis | ✅ |
| Priority Queue | ZADD con scoring | ✅ |
| Delayed Queue | Jobs diferidos | ✅ |
| Worker | Proceso consumidor | ✅ |
| JobProcessor | Ejecución con lifecycle | ✅ |
| WorkerRepository | Persistencia workers | ✅ |

## Arquitectura de Colas

```
┌─────────────────────────────────────────────────────────────┐
│                     API (POST /jobs)                         │
└──────────────────────────┬──────────────────────────────────┘
                           │
                    JobService.create()
                           │
              ┌────────────┴────────────┐
              │                         │
         scheduledAt?              No scheduledAt
              │                         │
              ▼                         ▼
    ┌─────────────────┐       ┌─────────────────┐
    │  Delayed Queue  │       │ Priority Queue  │
    │ (Redis ZSET)    │       │ (Redis ZSET)    │
    │ score=timestamp │       │ score=ts-prio   │
    └────────┬────────┘       └────────┬────────┘
             │                         │
             │    promoteDelayedJobs() │
             └──────────►──────────────┘
                           │
                      Worker.loop()
                           │
                      dequeue()
                           │
                    JobProcessor
                           │
              ┌────────────┼────────────┐
              │            │            │
           Success      Retry        Failure
              │            │            │
              ▼            ▼            ▼
         COMPLETED     RETRYING      FAILED
              │            │            │
              │      requeue()    moveToDLQ()
              │            │            │
         [webhook]    Delayed Q    Dead Letter Q
```

## Claves Redis

```
scheduler:queue:priority    # Sorted Set - Cola principal
scheduler:queue:delayed     # Sorted Set - Jobs diferidos
scheduler:processing        # Hash - Jobs en proceso
scheduler:queue:dlq         # Sorted Set - Dead Letter Queue
```

## Estados de Jobs

```
PENDING ──► QUEUED ──► PROCESSING ──► COMPLETED
                │           │
                │           ├──► RETRYING ──► QUEUED
                │           │
                │           └──► FAILED (DLQ)
                │
                └──► CANCELLED
```

## Comandos

```bash
# Iniciar worker
pnpm worker

# Ver logs del worker
pnpm worker 2>&1 | pnpm pino-pretty

# Múltiples workers (producción)
pnpm worker &
pnpm worker &
pnpm worker &
```
