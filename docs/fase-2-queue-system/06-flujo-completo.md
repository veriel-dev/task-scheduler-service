# Flujo Completo

## De Creación a Completación

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. CREACIÓN (API)                                                    │
└─────────────────────────────────────────────────────────────────────┘

POST /api/v1/jobs
{
  "name": "Send Email",
  "type": "email.send",
  "payload": { "to": "user@example.com" },
  "priority": "HIGH"
}

    │
    ▼

┌─────────────────────────────────────────────────────────────────────┐
│ 2. JobService.create()                                               │
│    ├─ INSERT INTO jobs (status=PENDING)                             │
│    ├─ scheduledAt en futuro?                                        │
│    │   ├─ Sí: ZADD scheduler:queue:delayed                          │
│    │   └─ No: ZADD scheduler:queue:priority                         │
│    └─ UPDATE jobs SET status='QUEUED'                               │
└─────────────────────────────────────────────────────────────────────┘

    │
    ▼

┌─────────────────────────────────────────────────────────────────────┐
│ 3. Worker.loop()                                                     │
│    ├─ ZPOPMIN scheduler:queue:priority → jobId                      │
│    ├─ SELECT * FROM jobs WHERE id = jobId                           │
│    └─ status IN (QUEUED, RETRYING)? → processJob()                  │
└─────────────────────────────────────────────────────────────────────┘

    │
    ▼

┌─────────────────────────────────────────────────────────────────────┐
│ 4. JobProcessor.process()                                            │
│    ├─ Buscar handler para job.type                                  │
│    ├─ UPDATE jobs SET status='PROCESSING', startedAt=now            │
│    ├─ HSET scheduler:processing jobId {workerId, startedAt}         │
│    └─ Ejecutar handler(job)                                         │
└─────────────────────────────────────────────────────────────────────┘

    │
    ├──────────────────────┬──────────────────────┐
    ▼                      ▼                      ▼
  Éxito                  Error                 Error
                      (con reintentos)      (sin reintentos)
    │                      │                      │
    ▼                      ▼                      ▼

┌─────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ COMPLETED   │    │ RETRYING        │    │ FAILED          │
│             │    │                 │    │                 │
│ UPDATE jobs │    │ UPDATE jobs     │    │ UPDATE jobs     │
│ status=     │    │ status=RETRYING │    │ status=FAILED   │
│ COMPLETED   │    │ retryCount++    │    │ completedAt=now │
│ result={..} │    │ error=msg       │    │ error=msg       │
│ completedAt │    │                 │    │                 │
│             │    │ requeue() →     │    │ moveToDLQ()     │
│ HDEL        │    │ delayed queue   │    │ ZADD dlq        │
│ processing  │    │ con delay       │    │ HDEL processing │
│             │    │                 │    │                 │
│ webhook?    │    │ (vuelve a       │    │ webhook?        │
│ → POST url  │    │  paso 3)        │    │ → POST url      │
└─────────────┘    └─────────────────┘    └─────────────────┘
```

## Ejemplo: Job Exitoso

```
T+0ms    API: POST /jobs { type: "email.send", priority: "HIGH" }
T+5ms    DB: INSERT jobs (id=abc, status=PENDING)
T+8ms    Redis: ZADD scheduler:queue:priority {score} "abc"
T+10ms   DB: UPDATE jobs SET status=QUEUED
T+15ms   Response: { id: "abc", status: "QUEUED" }

T+1000ms Worker: ZPOPMIN → "abc"
T+1002ms DB: SELECT * FROM jobs WHERE id="abc"
T+1005ms DB: UPDATE jobs SET status=PROCESSING, startedAt=now
T+1008ms Redis: HSET scheduler:processing "abc" {...}
T+1010ms Handler: sendEmail(...)

T+2500ms Handler: return { sent: true }
T+2502ms DB: UPDATE jobs SET status=COMPLETED, result={...}
T+2505ms Redis: HDEL scheduler:processing "abc"
T+2508ms Webhook: POST https://webhook.url {...}
```

## Ejemplo: Job con Reintentos

```
T+0      Crear job (maxRetries=3, retryDelay=1000)
T+1s     Worker procesa → handler lanza error
T+1.1s   DB: status=RETRYING, retryCount=1
T+1.2s   Redis: ZADD delayed {T+2s} "job:priority"

T+2s     promoteDelayedJobs() mueve a priority queue
T+2.1s   Worker procesa → handler lanza error
T+2.2s   DB: status=RETRYING, retryCount=2
T+2.3s   Redis: ZADD delayed {T+4s} "job:priority"

T+4s     promoteDelayedJobs()
T+4.1s   Worker procesa → handler lanza error
T+4.2s   DB: status=RETRYING, retryCount=3
T+4.3s   Redis: ZADD delayed {T+8s} "job:priority"

T+8s     promoteDelayedJobs()
T+8.1s   Worker procesa → handler lanza error
T+8.2s   retryCount(3) >= maxRetries(3) → FAILED
T+8.3s   DB: status=FAILED
T+8.4s   Redis: ZADD dlq {...}, HDEL processing
T+8.5s   Webhook: POST {..., status: "failed"}
```

## Diagrama de Estados

```
┌─────────┐
│ PENDING │ ───────────────────────────────────────┐
└────┬────┘                                        │
     │ enqueue()                                   │ cancel()
     ▼                                             ▼
┌─────────┐                                   ┌───────────┐
│ QUEUED  │ ◄───────────────────────┐         │ CANCELLED │
└────┬────┘                         │         └───────────┘
     │ dequeue() + process()        │
     ▼                              │
┌────────────┐                      │
│ PROCESSING │                      │
└─────┬──────┘                      │
      │                             │
      ├──── éxito ──────────────────┼─────────────────┐
      │                             │                 │
      ├──── error + reintentos ─────┤                 │
      │                             │                 ▼
      │                     ┌───────────┐      ┌───────────┐
      │                     │ RETRYING  │      │ COMPLETED │
      │                     └─────┬─────┘      └───────────┘
      │                           │
      │                    promoteDelayedJobs()
      │                           │
      │                           └──────────► QUEUED
      │
      └──── error + sin reintentos ──────────────────┐
                                                     │
                                                     ▼
                                              ┌──────────┐
                                              │  FAILED  │
                                              │  + DLQ   │
                                              └──────────┘
```

## Componentes Involucrados

| Paso | Componente | Operación |
|------|------------|-----------|
| Crear | JobController | Validar request |
| Crear | JobService | Lógica de negocio |
| Crear | JobRepository | INSERT en BD |
| Crear | QueueManager | ZADD en Redis |
| Procesar | Worker | Loop + dequeue |
| Procesar | JobProcessor | Ejecutar handler |
| Procesar | QueueManager | markProcessing/Completed |
| Retry | QueueManager | requeue() |
| Fail | QueueManager | moveToDLQ() |
