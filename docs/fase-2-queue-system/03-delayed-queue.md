# Delayed Queue

## Concepto

La Delayed Queue almacena jobs programados para ejecutarse en el futuro.

## Estructura

```
Redis ZSET: scheduler:queue:delayed
├── score: Unix timestamp (ms) de ejecución
└── value: "jobId:priority"
```

## Flujo

```
1. API crea job con scheduledAt
   POST /jobs { scheduledAt: "2025-01-05T10:00:00Z" }

2. JobService detecta scheduledAt en futuro
   if (job.scheduledAt > new Date()) {
     await queueManager.enqueueDelayed(...)
   }

3. Job queda en delayed queue
   ZADD scheduler:queue:delayed 1735988400000 "job-123:HIGH"

4. Worker ejecuta promoteDelayedJobs() cada 5s
   - Busca jobs con score <= ahora
   - Los mueve a priority queue
   - Los elimina de delayed queue

5. Job se procesa normalmente
```

## Implementación

### Encolar diferido

```typescript
async enqueueDelayed(
  jobId: string,
  scheduledAt: Date,
  priority: JobPriority
): Promise<void> {
  const score = scheduledAt.getTime(); // Unix timestamp
  await this.client.zAdd(QUEUE_KEYS.DELAYED, {
    score,
    value: `${jobId}:${priority}`, // Guarda prioridad para después
  });
}
```

### Promover jobs listos

```typescript
async promoteDelayedJobs(): Promise<number> {
  const now = Date.now();

  // Buscar jobs con score <= ahora
  const readyJobs = await this.client.zRangeByScore(
    QUEUE_KEYS.DELAYED,
    0,
    now
  );

  if (readyJobs.length === 0) return 0;

  for (const entry of readyJobs) {
    const [jobId, priority] = entry.split(':') as [string, JobPriority];

    // Mover a priority queue con scoring correcto
    await this.enqueue(jobId, priority);

    // Eliminar de delayed queue
    await this.client.zRem(QUEUE_KEYS.DELAYED, entry);
  }

  return readyJobs.length;
}
```

## Timer de Promoción

El Worker ejecuta la promoción cada 5 segundos:

```typescript
private startDelayedPromoter(): void {
  this.promoteTimer = setInterval(async () => {
    try {
      const promoted = await this.queueManager.promoteDelayedJobs();
      if (promoted > 0) {
        this.logger.debug({ count: promoted }, 'Promoted delayed jobs');
      }
    } catch (error) {
      this.logger.error({ error }, 'Failed to promote delayed jobs');
    }
  }, this.config.promoteIntervalMs); // 5000ms
}
```

## Ejemplo

```typescript
// Crear job para ejecutar en 1 hora
const job = await jobService.create({
  name: 'Scheduled Report',
  type: 'report.generate',
  payload: { reportId: 'monthly' },
  scheduledAt: new Date(Date.now() + 60 * 60 * 1000), // +1 hora
});

// Estado: QUEUED (pero en delayed queue)
// Redis: ZADD scheduler:queue:delayed {timestamp+1h} "job-id:NORMAL"

// Después de 1 hora, promoteDelayedJobs() lo mueve
// Redis: ZADD scheduler:queue:priority {score} "job-id"
// Redis: ZREM scheduler:queue:delayed "job-id:NORMAL"
```

## Operaciones Redis

```bash
# Ver jobs diferidos
ZRANGE scheduler:queue:delayed 0 -1 WITHSCORES

# Ver jobs listos para promover
ZRANGEBYSCORE scheduler:queue:delayed 0 {now}

# Contar diferidos
ZCARD scheduler:queue:delayed
```
