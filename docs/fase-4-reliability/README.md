# Fase 4: Reliability

Esta documentacion describe la implementacion de los componentes de fiabilidad del Task Scheduler Service.

## Contenido

1. [Dead Letter Queue](./01-dead-letter-queue.md)
2. [Orphan Job Recovery](./02-orphan-job-recovery.md)
3. [Webhook System](./03-webhook-system.md)
4. [Metrics y Health Checks](./04-metrics-health-checks.md)

## Resumen

La Fase 4 implementa los mecanismos de fiabilidad del sistema:

| Componente | Descripcion | Estado |
|------------|-------------|--------|
| Dead Letter Queue | Persistencia de jobs fallidos | ✅ |
| OrphanJobRecovery | Recuperacion automatica | ✅ |
| WebhookDispatcher | Notificaciones HTTP | ✅ |
| WebhookRetryProcessor | Reintentos con backoff | ✅ |
| MetricsService | Metricas del sistema | ✅ |
| Health Checks | Liveness/Readiness probes | ✅ |

## Arquitectura de Reliability

```
┌─────────────────────────────────────────────────────────────────┐
│                        JobProcessor                              │
│                     (procesa cada job)                           │
└──────────────────────────┬──────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
           Success                   Failure
              │                         │
              ▼                         ▼
    ┌─────────────────┐       ┌─────────────────┐
    │ WebhookDispatcher│      │ retryCount <    │
    │ (si webhookUrl) │       │ maxRetries?     │
    └────────┬────────┘       └────────┬────────┘
             │                    │         │
             │                   Yes        No
             │                    │         │
             │                    ▼         ▼
             │              ┌─────────┐ ┌─────────────┐
             │              │ Requeue │ │ Dead Letter │
             │              │ +delay  │ │   Queue     │
             │              └─────────┘ └──────┬──────┘
             │                                 │
             ▼                                 ▼
    ┌─────────────────┐              ┌─────────────────┐
    │ WebhookEvent    │              │ DeadLetterJob   │
    │ (PostgreSQL)    │              │ (PostgreSQL)    │
    └────────┬────────┘              └─────────────────┘
             │
             │ Si falla
             ▼
    ┌─────────────────┐
    │ WebhookRetry    │
    │ Processor       │
    │ (backoff exp)   │
    └─────────────────┘
```

## Recuperacion de Jobs Huerfanos

```
┌─────────────────────────────────────────────────────────────────┐
│                    OrphanJobRecovery                             │
│                  (ejecuta cada 60 segundos)                      │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │ findStaleWorkers()     │
              │ lastHeartbeat > 90s    │
              └───────────┬────────────┘
                          │
                          ▼
              ┌────────────────────────┐
              │ Para cada stale worker │
              │ - Buscar jobs PROCESSING│
              │ - Actualizar a RETRYING │
              │ - Re-encolar con delay │
              │ - Marcar worker stopped │
              └────────────────────────┘
```

## Health Checks

```
GET /health/live   ──► { status: "ok" }

GET /health/ready  ──► {
                         status: "healthy|degraded|unhealthy",
                         checks: {
                           database: { status, latencyMs },
                           redis: { status, latencyMs },
                           workers: { status, activeCount }
                         }
                       }
```

## Endpoints API

### Dead Letter Queue
```
GET    /api/v1/dead-letter           # Listar jobs fallidos
GET    /api/v1/dead-letter/:id       # Detalle de job
POST   /api/v1/dead-letter/:id/retry # Reintentar job
DELETE /api/v1/dead-letter/:id       # Eliminar de DLQ
GET    /api/v1/dead-letter/stats     # Estadisticas
```

### Metrics
```
GET    /api/v1/metrics/overview      # Resumen completo
GET    /api/v1/metrics/queues        # Stats de colas
GET    /api/v1/metrics/workers       # Stats de workers
GET    /api/v1/metrics/jobs          # Stats de jobs
GET    /api/v1/metrics/schedules     # Stats de schedules
```

## Tests

```bash
# Ejecutar tests de Fase 4
pnpm test dead-letter OrphanJobRecovery metrics WebhookDispatcher

# Total: 36 tests nuevos
```
