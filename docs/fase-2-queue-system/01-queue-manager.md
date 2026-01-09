# QueueManager

## Descripción

El QueueManager es la abstracción sobre Redis que gestiona las colas de jobs.

**Archivo:** `src/core/queue/QueueManager.ts`

## Claves Redis

```typescript
const REDIS_PREFIX = 'scheduler';

const QUEUE_KEYS = {
  PRIORITY: 'scheduler:queue:priority',    // Sorted Set
  DELAYED: 'scheduler:queue:delayed',      // Sorted Set
  PROCESSING: 'scheduler:processing',      // Hash
  DEAD_LETTER: 'scheduler:queue:dlq',      // Sorted Set
};
```

## Scoring de Prioridad

```typescript
const PRIORITY_SCORES: Record<JobPriority, number> = {
  CRITICAL: 0,
  HIGH:     1_000_000,
  NORMAL:   2_000_000,
  LOW:      3_000_000,
};

private calculateScore(priority: JobPriority, timestamp?: Date): number {
  const ts = timestamp ? timestamp.getTime() : Date.now();
  return ts - PRIORITY_SCORES[priority];
}
```

**Ejemplo:**
```
Job CRITICAL en T=1000000 → score = 1000000 - 0       = 1000000
Job LOW en T=1000000      → score = 1000000 - 3000000 = -2000000

ZPOPMIN retorna menor score primero → CRITICAL se procesa antes
```

## Métodos

### enqueue

```typescript
async enqueue(jobId: string, priority: JobPriority): Promise<void> {
  const score = this.calculateScore(priority);
  await this.client.zAdd(QUEUE_KEYS.PRIORITY, {
    score,
    value: jobId,
  });
}
```

### enqueueDelayed

```typescript
async enqueueDelayed(
  jobId: string,
  scheduledAt: Date,
  priority: JobPriority
): Promise<void> {
  const score = scheduledAt.getTime();
  await this.client.zAdd(QUEUE_KEYS.DELAYED, {
    score,
    value: `${jobId}:${priority}`,
  });
}
```

### dequeue

```typescript
async dequeue(): Promise<string | null> {
  const result = await this.client.zPopMin(QUEUE_KEYS.PRIORITY);
  if (!result) return null;
  return result.value;
}
```

### promoteDelayedJobs

```typescript
async promoteDelayedJobs(): Promise<number> {
  const now = Date.now();
  const readyJobs = await this.client.zRangeByScore(QUEUE_KEYS.DELAYED, 0, now);

  if (readyJobs.length === 0) return 0;

  for (const entry of readyJobs) {
    const [jobId, priority] = entry.split(':') as [string, JobPriority];
    await this.enqueue(jobId, priority);
    await this.client.zRem(QUEUE_KEYS.DELAYED, entry);
  }

  return readyJobs.length;
}
```

### markProcessing

```typescript
async markProcessing(jobId: string, workerId: string): Promise<void> {
  await this.client.hSet(
    QUEUE_KEYS.PROCESSING,
    jobId,
    JSON.stringify({ workerId, startedAt: Date.now() })
  );
}
```

### markCompleted

```typescript
async markCompleted(jobId: string): Promise<void> {
  await this.client.hDel(QUEUE_KEYS.PROCESSING, jobId);
}
```

### moveToDLQ

```typescript
async moveToDLQ(jobId: string, reason: string): Promise<void> {
  await this.client.zAdd(QUEUE_KEYS.DEAD_LETTER, {
    score: Date.now(),
    value: JSON.stringify({ jobId, reason, failedAt: new Date().toISOString() }),
  });
  await this.client.hDel(QUEUE_KEYS.PROCESSING, jobId);
}
```

### requeue

```typescript
async requeue(jobId: string, priority: JobPriority, delayMs: number): Promise<void> {
  const scheduledAt = new Date(Date.now() + delayMs);
  await this.enqueueDelayed(jobId, scheduledAt, priority);
  await this.client.hDel(QUEUE_KEYS.PROCESSING, jobId);
}
```

### getStats

```typescript
async getStats(): Promise<{
  priority: number;
  delayed: number;
  processing: number;
  dlq: number;
}> {
  const [priority, delayed, processing, dlq] = await Promise.all([
    this.client.zCard(QUEUE_KEYS.PRIORITY),
    this.client.zCard(QUEUE_KEYS.DELAYED),
    this.client.hLen(QUEUE_KEYS.PROCESSING),
    this.client.zCard(QUEUE_KEYS.DEAD_LETTER),
  ]);

  return { priority, delayed, processing, dlq };
}
```

## Decisiones de Diseño

| Decisión | Razón |
|----------|-------|
| Sorted Sets | O(log N), ordenamiento automático |
| Score = ts - priority | Jobs críticos siempre primero |
| Hash para processing | Tracking de workers activos |
| ZPOPMIN | Atómico, sin race conditions |
| Polling vs BRPOP | Necesita prioridad y timestamps |
