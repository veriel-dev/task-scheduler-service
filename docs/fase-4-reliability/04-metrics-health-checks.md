# Metrics y Health Checks

## Proposito

Proporcionar visibilidad del estado del sistema y permitir integracion con orquestadores (Kubernetes, Docker Swarm) mediante health checks estandar.

## Health Checks

### Liveness Probe

```http
GET /health/live
```

Verifica que la aplicacion esta corriendo. Siempre retorna 200 si el proceso esta vivo.

```json
{
  "status": "ok"
}
```

**Uso en Kubernetes:**
```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 15
```

### Readiness Probe

```http
GET /health/ready
```

Verifica que el sistema puede procesar requests (BD, Redis y workers disponibles).

```json
{
  "status": "healthy",
  "checks": {
    "database": {
      "status": "ok",
      "latencyMs": 5
    },
    "redis": {
      "status": "ok",
      "latencyMs": 2
    },
    "workers": {
      "status": "ok",
      "activeCount": 2
    }
  }
}
```

**Estados posibles:**

| Status | Condicion | HTTP Code |
|--------|-----------|-----------|
| healthy | Todo OK | 200 |
| degraded | BD/Redis OK, sin workers activos | 200 |
| unhealthy | BD o Redis fallando | 503 |

**Uso en Kubernetes:**
```yaml
readinessProbe:
  httpGet:
    path: /health/ready
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
```

## MetricsService

### Overview

```http
GET /api/v1/metrics/overview
```

Resumen completo del sistema:

```json
{
  "queues": {
    "priority": 15,
    "delayed": 5,
    "processing": 3,
    "dlq": 2
  },
  "workers": {
    "total": 4,
    "active": 2,
    "idle": 1,
    "stopped": 1,
    "totalProcessed": 1250,
    "totalFailed": 45
  },
  "jobs": {
    "total": 5000,
    "byStatus": {
      "PENDING": 100,
      "QUEUED": 15,
      "PROCESSING": 3,
      "COMPLETED": 4800,
      "FAILED": 50,
      "RETRYING": 7,
      "CANCELLED": 25
    },
    "last24h": {
      "created": 150,
      "completed": 140,
      "failed": 5
    }
  },
  "schedules": {
    "total": 10,
    "enabled": 8,
    "disabled": 2,
    "totalRuns": 500
  },
  "uptime": 86400
}
```

### Queue Stats

```http
GET /api/v1/metrics/queues
```

```json
{
  "priority": 15,
  "delayed": 5,
  "processing": 3,
  "dlq": 2
}
```

### Worker Stats

```http
GET /api/v1/metrics/workers
```

```json
{
  "total": 4,
  "active": 2,
  "idle": 1,
  "stopped": 1,
  "totalProcessed": 1250,
  "totalFailed": 45
}
```

### Job Stats

```http
GET /api/v1/metrics/jobs
```

```json
{
  "total": 5000,
  "byStatus": {
    "PENDING": 100,
    "QUEUED": 15,
    "COMPLETED": 4800
  },
  "last24h": {
    "created": 150,
    "completed": 140,
    "failed": 5
  }
}
```

### Schedule Stats

```http
GET /api/v1/metrics/schedules
```

```json
{
  "total": 10,
  "enabled": 8,
  "disabled": 2,
  "totalRuns": 500
}
```

## Implementacion

### MetricsService

```typescript
// src/services/metrics.service.ts

export class MetricsService {
  private readonly startTime = Date.now();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: RedisClientType,
    private readonly queueManager: QueueManager
  ) {}

  async getQueueStats(): Promise<QueueStats> {
    return this.queueManager.getStats();
  }

  async getWorkerStats(): Promise<WorkerStats> {
    const workers = await this.prisma.worker.findMany();

    const stats = workers.reduce(
      (acc, w) => {
        acc.total++;
        if (w.status === 'active') acc.active++;
        else if (w.status === 'idle') acc.idle++;
        else if (w.status === 'stopped') acc.stopped++;
        acc.totalProcessed += w.processedCount;
        acc.totalFailed += w.failedCount;
        return acc;
      },
      { total: 0, active: 0, idle: 0, stopped: 0, totalProcessed: 0, totalFailed: 0 }
    );

    return stats;
  }

  async getJobStats(): Promise<JobStats> {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [total, byStatus, created24h, completed24h, failed24h] = await Promise.all([
      this.prisma.job.count(),
      this.prisma.job.groupBy({
        by: ['status'],
        _count: { status: true },
      }),
      this.prisma.job.count({ where: { createdAt: { gte: oneDayAgo } } }),
      this.prisma.job.count({
        where: { status: 'COMPLETED', completedAt: { gte: oneDayAgo } },
      }),
      this.prisma.job.count({
        where: { status: 'FAILED', completedAt: { gte: oneDayAgo } },
      }),
    ]);

    return {
      total,
      byStatus: Object.fromEntries(
        byStatus.map(b => [b.status, b._count.status])
      ),
      last24h: {
        created: created24h,
        completed: completed24h,
        failed: failed24h,
      },
    };
  }

  async getHealthStatus(): Promise<HealthStatus> {
    const checks = {
      database: await this.checkDatabase(),
      redis: await this.checkRedis(),
      workers: await this.checkWorkers(),
    };

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    if (checks.database.status === 'error' || checks.redis.status === 'error') {
      status = 'unhealthy';
    } else if (checks.workers.status === 'warning') {
      status = 'degraded';
    }

    return { status, checks };
  }

  private async checkDatabase(): Promise<HealthCheck> {
    const start = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', latencyMs: Date.now() - start };
    } catch (error) {
      return {
        status: 'error',
        latencyMs: Date.now() - start,
        error: (error as Error).message,
      };
    }
  }

  private async checkRedis(): Promise<HealthCheck> {
    const start = Date.now();
    try {
      await this.redis.ping();
      return { status: 'ok', latencyMs: Date.now() - start };
    } catch (error) {
      return {
        status: 'error',
        latencyMs: Date.now() - start,
        error: (error as Error).message,
      };
    }
  }

  private async checkWorkers(): Promise<WorkerCheck> {
    const activeCount = await this.prisma.worker.count({
      where: { status: 'active' },
    });

    if (activeCount === 0) {
      return { status: 'warning', activeCount, message: 'No active workers' };
    }

    return { status: 'ok', activeCount };
  }

  async getOverview(): Promise<SystemOverview> {
    const [queues, workers, jobs, schedules] = await Promise.all([
      this.getQueueStats(),
      this.getWorkerStats(),
      this.getJobStats(),
      this.getScheduleStats(),
    ]);

    return {
      queues,
      workers,
      jobs,
      schedules,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }
}
```

### Health Check en Server

```typescript
// src/api/server.ts

app.get('/health/live', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/health/ready', async (_req, res) => {
  const health = await container.metricsService.getHealthStatus();
  const statusCode = health.status === 'unhealthy' ? 503 : 200;
  res.status(statusCode).json(health);
});
```

## Tipos

```typescript
interface QueueStats {
  priority: number;
  delayed: number;
  processing: number;
  dlq: number;
}

interface WorkerStats {
  total: number;
  active: number;
  idle: number;
  stopped: number;
  totalProcessed: number;
  totalFailed: number;
}

interface JobStats {
  total: number;
  byStatus: Record<string, number>;
  last24h: {
    created: number;
    completed: number;
    failed: number;
  };
}

interface ScheduleStats {
  total: number;
  enabled: number;
  disabled: number;
  totalRuns: number;
}

interface HealthCheck {
  status: 'ok' | 'error';
  latencyMs: number;
  error?: string;
}

interface WorkerCheck {
  status: 'ok' | 'warning';
  activeCount: number;
  message?: string;
}

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: {
    database: HealthCheck;
    redis: HealthCheck;
    workers: WorkerCheck;
  };
}

interface SystemOverview {
  queues: QueueStats;
  workers: WorkerStats;
  jobs: JobStats;
  schedules: ScheduleStats;
  uptime: number;
}
```

## Archivos Relacionados

| Archivo | Descripcion |
|---------|-------------|
| `src/services/metrics.service.ts` | Logica de metricas |
| `src/api/controllers/metrics.controller.ts` | HTTP handlers |
| `src/api/routes/v1/metrics.routes.ts` | Rutas |
| `src/api/server.ts` | Health endpoints |

## Tests

```bash
pnpm test metrics.service.test
```

Cobertura:
- getQueueStats()
- getWorkerStats() con workers vacios y con datos
- getJobStats() con agrupacion por status
- getScheduleStats()
- getHealthStatus() healthy, degraded, unhealthy
- getOverview() agregacion completa
