import type { RedisClientType } from 'redis';
import { logger } from '../../infrastructure/index.js';
import type { JobPriority } from '@prisma/client';

// Prefijo para todas las claves de Redis
const REDIS_PREFIX = 'scheduler';

// Claves de las colas
export const QUEUE_KEYS = {
  PRIORITY: `${REDIS_PREFIX}:queue:priority`, // Cola principal con prioridad
  DELAYED: `${REDIS_PREFIX}:queue:delayed`, // Cola de jobs diferidos
  PROCESSING: `${REDIS_PREFIX}:processing`, // Jobs en proceso (hash)
  DEAD_LETTER: `${REDIS_PREFIX}:queue:dlq`, // Dead Letter Queue
};

// Mapeo de prioridad a score (meno = mayor prioridad)
const PRIORITY_SCORES: Record<JobPriority, number> = {
  CRITICAL: 0,
  HIGH: 1000000,
  NORMAL: 2000000,
  LOW: 3000000,
};

export class QueueManager {
  private client: RedisClientType;
  constructor(client: RedisClientType) {
    this.client = client;
  }

  /**
   * Calcula el score para un job basado en timestamp y prioridad
   * Score = timestamp - (prioridad_offset)
   * Esto asegura que jobs con mayor prioridad se procesan primero
   */
  private calculateScore(priority: JobPriority, timestamp?: Date): number {
    const ts = timestamp ? timestamp.getTime() : Date.now();
    return ts - PRIORITY_SCORES[priority];
  }
  /**
   * Encola un job en la cola de prioridad
   */
  async enqueue(jobId: string, priority: JobPriority): Promise<void> {
    const score = this.calculateScore(priority);
    await this.client.zAdd(QUEUE_KEYS.PRIORITY, {
      score,
      value: jobId,
    });
    logger.debug({ jobId, priority, score }, 'Job enqueued to priority queue');
  }
  /**
   * Encola un job para ejecución diferida
   */
  async enqueueDelayed(jobId: string, scheduledAt: Date, priority: JobPriority): Promise<void> {
    const score = scheduledAt.getTime();
    await this.client.zAdd(QUEUE_KEYS.DELAYED, {
      score,
      value: `${jobId}:${priority}`,
    });
    logger.debug({ jobId, scheduledAt, priority }, 'Job enqueued to delayed queue');
  }
  /**
   * Obtiene el siguiente job a procesar (el de menor score)
   * Usa ZPOPADMIN para obtener y remover atómicamente
   */
  async dequeue(): Promise<string | null> {
    const result = await this.client.zPopMin(QUEUE_KEYS.PRIORITY);
    if (!result) {
      return null;
    }
    return result.value;
  }
  /**
   * Mueve jobs diferidos que ya están listos a la cola de prioridad
   * Retorna el número de jobs movidos
   */
  async promoteDelayedJobs(): Promise<number> {
    const now = Date.now();
    const readyJobs = await this.client.zRangeByScore(QUEUE_KEYS.DELAYED, 0, now);
    if (readyJobs.length === 0) {
      return 0;
    }
    for (const entry of readyJobs) {
      const [jobId, priority] = entry.split(':') as [string, JobPriority];
      await this.enqueue(jobId, priority);
      await this.client.zRem(QUEUE_KEYS.DELAYED, entry);
    }
    logger.info({ count: readyJobs.length }, 'Promoted delayed jobs to priority queue');
    return readyJobs.length;
  }
  /**
   * Marca un job como en proceso
   */
  async markProcessing(jobId: string, workerId: string): Promise<void> {
    await this.client.hSet(
      QUEUE_KEYS.PROCESSING,
      jobId,
      JSON.stringify({
        workerId,
        startedAt: Date.now(),
      })
    );
  }
  /**
   * Marca un job como completado (lo remueve de processing)
   */
  async markCompleted(jobId: string): Promise<void> {
    await this.client.hDel(QUEUE_KEYS.PROCESSING, jobId);
  }
  /**
   * Mueve un job a la Dead Letter Queue
   */
  async moveToDLQ(jobId: string, reason: string): Promise<void> {
    await this.client.zAdd(QUEUE_KEYS.DEAD_LETTER, {
      score: Date.now(),
      value: JSON.stringify({ jobId, reason, failedAt: new Date().toISOString() }),
    });
    await this.client.hDel(QUEUE_KEYS.PROCESSING, jobId);
    logger.warn({ jobId, reason }, 'Job moved to DLQ');
  }
  /**
   * Obtiene estadísticas de las colas
   */
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
  /**
   * Re-encola un job para reintento con delay
   */
  async requeue(jobId: string, priority: JobPriority, delayMs: number): Promise<void> {
    const scheduledAt = new Date(Date.now() + delayMs);
    await this.enqueueDelayed(jobId, scheduledAt, priority);
    await this.client.hDel(QUEUE_KEYS.PROCESSING, jobId);
    logger.debug({ jobId, delayMs }, 'Job requeued for retry');
  }
}
