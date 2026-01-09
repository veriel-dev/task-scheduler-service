# Task Scheduler Service - Arquitectura

## Descripcion General

Servicio de programacion de tareas y colas de trabajo asincrono. Permite crear jobs puntuales, tareas programadas (cron), y gestionar workers distribuidos para procesamiento en paralelo.

## Stack Tecnologico

| Componente | Tecnologia |
|------------|------------|
| Runtime | Node.js 20+ |
| Lenguaje | TypeScript 5.x |
| Framework | Express.js / Fastify |
| Base de datos | PostgreSQL 15+ |
| Cache/Colas | Redis 7+ |
| ORM | Prisma |
| Validacion | Zod |
| Testing | Vitest |
| Contenedores | Docker + Docker Compose |

## Arquitectura del Sistema

```
                                    +------------------+
                                    |   API Gateway    |
                                    |   (Express)      |
                                    +--------+---------+
                                             |
              +------------------------------+------------------------------+
              |                              |                              |
    +---------v---------+         +----------v----------+         +---------v---------+
    |   Job Controller  |         | Schedule Controller |         | Metrics Controller|
    +-------------------+         +---------------------+         +-------------------+
              |                              |                              |
    +---------v---------+         +----------v----------+         +---------v---------+
    |   Job Service     |         | Schedule Service    |         | Metrics Service   |
    +-------------------+         +---------------------+         +-------------------+
              |                              |                              |
              +------------------------------+------------------------------+
                                             |
                              +--------------v--------------+
                              |      Queue Manager          |
                              |  (Abstraccion sobre Redis)  |
                              +-----------------------------+
                                             |
                    +------------------------+------------------------+
                    |                        |                        |
          +---------v---------+    +---------v---------+    +---------v---------+
          |  Priority Queue   |    |   Delayed Queue   |    | Dead Letter Queue |
          |     (Redis)       |    |     (Redis)       |    |    (PostgreSQL)   |
          +-------------------+    +-------------------+    +-------------------+
                    |
          +---------v---------+
          |   Worker Pool     |
          | (Procesos/Threads)|
          +-------------------+
```

## Estructura de Directorios

```
task-scheduler-service/
├── src/
│   ├── api/
│   │   ├── controllers/
│   │   │   ├── job.controller.ts
│   │   │   ├── schedule.controller.ts
│   │   │   ├── worker.controller.ts
│   │   │   └── metrics.controller.ts
│   │   ├── routes/
│   │   │   ├── index.ts
│   │   │   ├── job.routes.ts
│   │   │   ├── schedule.routes.ts
│   │   │   └── metrics.routes.ts
│   │   ├── middlewares/
│   │   │   ├── auth.middleware.ts
│   │   │   ├── error.middleware.ts
│   │   │   ├── validation.middleware.ts
│   │   │   └── rateLimit.middleware.ts
│   │   └── server.ts
│   │
│   ├── core/
│   │   ├── queue/
│   │   │   ├── QueueManager.ts       # Abstraccion sobre Redis (implementado)
│   │   │   └── index.ts
│   │   ├── scheduler/
│   │   │   ├── CronParser.ts
│   │   │   ├── ScheduleExecutor.ts
│   │   │   └── ScheduleStore.ts
│   │   └── worker/
│   │       ├── Worker.ts             # Worker single process (implementado)
│   │       ├── JobProcessor.ts       # Procesador con lifecycle (implementado)
│   │       └── index.ts
│   │
│   ├── services/
│   │   ├── job.service.ts
│   │   ├── schedule.service.ts
│   │   ├── worker.service.ts
│   │   ├── metrics.service.ts
│   │   └── webhook.service.ts
│   │
│   ├── repositories/
│   │   ├── job.repository.ts
│   │   ├── schedule.repository.ts
│   │   └── metrics.repository.ts
│   │
│   ├── domain/
│   │   ├── entities/
│   │   │   ├── Job.ts
│   │   │   ├── Schedule.ts
│   │   │   └── Worker.ts
│   │   ├── enums/
│   │   │   ├── JobStatus.ts
│   │   │   ├── JobPriority.ts
│   │   │   └── ScheduleType.ts
│   │   └── events/
│   │       ├── JobEvents.ts
│   │       └── ScheduleEvents.ts
│   │
│   ├── infrastructure/
│   │   ├── database/
│   │   │   ├── prisma.client.ts
│   │   │   └── migrations/
│   │   ├── redis/
│   │   │   ├── redis.client.ts
│   │   │   └── redis.scripts.ts
│   │   └── logger/
│   │       └── winston.config.ts
│   │
│   ├── config/
│   │   ├── index.ts
│   │   ├── database.config.ts
│   │   ├── redis.config.ts
│   │   └── queue.config.ts
│   │
│   ├── shared/
│   │   ├── errors/
│   │   │   ├── AppError.ts
│   │   │   ├── JobError.ts
│   │   │   └── ValidationError.ts
│   │   ├── utils/
│   │   │   ├── cron.utils.ts
│   │   │   ├── retry.utils.ts
│   │   │   └── id.utils.ts
│   │   └── types/
│   │       ├── job.types.ts
│   │       ├── schedule.types.ts
│   │       └── api.types.ts
│   │
│   └── app.ts
│
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
│
├── tests/
│   ├── unit/
│   │   ├── core/
│   │   └── services/
│   ├── integration/
│   │   ├── api/
│   │   └── queue/
│   └── e2e/
│
├── docker/
│   ├── Dockerfile
│   ├── Dockerfile.worker
│   └── docker-compose.yml
│
├── scripts/
│   ├── start-worker.ts
│   └── migrate.ts
│
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

## Modelos de Datos (Prisma Schema)

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum JobStatus {
  PENDING
  QUEUED
  PROCESSING
  COMPLETED
  FAILED
  RETRYING
  CANCELLED
}

enum JobPriority {
  LOW
  NORMAL
  HIGH
  CRITICAL
}

model Job {
  id            String      @id @default(uuid())
  name          String
  payload       Json
  status        JobStatus   @default(PENDING)
  priority      JobPriority @default(NORMAL)

  // Configuracion de reintentos
  maxRetries    Int         @default(3)
  retryCount    Int         @default(0)
  retryDelay    Int         @default(1000)  // ms

  // Tiempos
  scheduledAt   DateTime?
  startedAt     DateTime?
  completedAt   DateTime?

  // Resultados
  result        Json?
  error         String?

  // Relaciones
  scheduleId    String?
  schedule      Schedule?   @relation(fields: [scheduleId], references: [id])
  workerId      String?

  // Webhook
  webhookUrl    String?

  // Metadata
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  @@index([status])
  @@index([priority])
  @@index([scheduledAt])
}

model Schedule {
  id            String    @id @default(uuid())
  name          String
  description   String?

  // Expresion cron o intervalo
  cronExpression String?
  intervalMs     Int?

  // Payload del job a crear
  jobName       String
  jobPayload    Json
  jobPriority   JobPriority @default(NORMAL)

  // Estado
  isActive      Boolean   @default(true)
  lastRunAt     DateTime?
  nextRunAt     DateTime?

  // Configuracion
  timezone      String    @default("UTC")
  maxRetries    Int       @default(3)
  webhookUrl    String?

  // Relaciones
  jobs          Job[]

  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([isActive])
  @@index([nextRunAt])
}

model DeadLetterJob {
  id            String    @id @default(uuid())
  originalJobId String
  jobName       String
  payload       Json
  error         String
  retryCount    Int
  failedAt      DateTime  @default(now())

  // Para reprocessamiento
  reprocessed   Boolean   @default(false)
  reprocessedAt DateTime?

  @@index([failedAt])
  @@index([reprocessed])
}

model JobMetrics {
  id            String    @id @default(uuid())
  date          DateTime  @db.Date

  // Contadores
  totalCreated  Int       @default(0)
  totalCompleted Int      @default(0)
  totalFailed   Int       @default(0)

  // Tiempos promedio (ms)
  avgProcessingTime Float @default(0)
  avgWaitTime       Float @default(0)

  // Por prioridad
  completedByPriority Json @default("{}")

  @@unique([date])
}
```

## API Endpoints

### Jobs

```
POST   /api/v1/jobs
  Body: { name, payload, priority?, scheduledAt?, webhookUrl?, maxRetries? }
  Response: { id, status, createdAt }

GET    /api/v1/jobs
  Query: { status?, priority?, page?, limit? }
  Response: { jobs[], total, page, limit }

GET    /api/v1/jobs/:id
  Response: { id, name, status, payload, result, error, ... }

DELETE /api/v1/jobs/:id
  Response: { success: true }

POST   /api/v1/jobs/:id/cancel
  Response: { id, status: "CANCELLED" }

POST   /api/v1/jobs/:id/retry
  Response: { id, status: "PENDING", retryCount }
```

### Schedules

```
POST   /api/v1/schedules
  Body: { name, cronExpression?, intervalMs?, jobName, jobPayload, timezone? }
  Response: { id, nextRunAt }

GET    /api/v1/schedules
  Query: { isActive?, page?, limit? }
  Response: { schedules[], total }

GET    /api/v1/schedules/:id
  Response: { id, name, cronExpression, lastRunAt, nextRunAt, jobs[] }

PATCH  /api/v1/schedules/:id
  Body: { isActive?, cronExpression?, ... }
  Response: { id, updatedAt }

DELETE /api/v1/schedules/:id
  Response: { success: true }

POST   /api/v1/schedules/:id/trigger
  Description: Ejecuta inmediatamente la tarea programada
  Response: { jobId }
```

### Dead Letter Queue

```
GET    /api/v1/dead-letter
  Query: { page?, limit?, jobType? }
  Response: { data[], total, page, limit, totalPages }

GET    /api/v1/dead-letter/:id
  Response: { id, originalJobId, jobName, jobType, failureReason, ... }

POST   /api/v1/dead-letter/:id/retry
  Response: { id, status: "QUEUED", ... }

DELETE /api/v1/dead-letter/:id
  Response: 204 No Content

GET    /api/v1/dead-letter/stats
  Response: { total, byType[], oldest, newest }
```

### Metrics

```
GET    /api/v1/metrics/overview
  Response: {
    queues: { priority, delayed, processing, dlq },
    workers: { total, active, idle, stopped, totalProcessed, totalFailed },
    jobs: { total, byStatus, last24h },
    schedules: { total, enabled, disabled, totalRuns },
    uptime
  }

GET    /api/v1/metrics/queues
  Response: { priority, delayed, processing, dlq }

GET    /api/v1/metrics/workers
  Response: { total, active, idle, stopped, totalProcessed, totalFailed }

GET    /api/v1/metrics/jobs
  Response: { total, byStatus, last24h }

GET    /api/v1/metrics/schedules
  Response: { total, enabled, disabled, totalRuns }
```

### Health Checks

```
GET    /health/live
  Description: Liveness probe - verifica que la app esta corriendo
  Response: { status: "ok" }

GET    /health/ready
  Description: Readiness probe - verifica BD, Redis y workers
  Response: {
    status: "healthy" | "degraded" | "unhealthy",
    checks: {
      database: { status, latencyMs, error? },
      redis: { status, latencyMs, error? },
      workers: { status, activeCount, message? }
    }
  }
```

### Workers (WebSocket)

```
WS     /api/v1/workers/connect
  Description: Conexion para workers remotos
  Messages:
    -> { type: "register", workerId, capabilities }
    <- { type: "job", job: { id, name, payload } }
    -> { type: "complete", jobId, result }
    -> { type: "fail", jobId, error }
    <- { type: "heartbeat" }
```

## Flujo de Procesamiento de Jobs

```
1. Cliente crea job via API
           |
           v
2. JobService valida y persiste en PostgreSQL
           |
           v
3. Job se encola en Redis (PriorityQueue)
           |
           v
4. WorkerPool detecta job disponible
           |
           v
5. Worker toma el job (atomico con BRPOPLPUSH)
           |
           v
6. JobProcessor ejecuta el job
           |
     +-----+-----+
     |           |
   Exito       Error
     |           |
     v           v
7a. Marca como   7b. Evalua reintentos
    COMPLETED         |
     |          +-----+-----+
     v          |           |
8a. Webhook   Reintenta   Max alcanzado
    (opcional)    |           |
     |            v           v
     v          Vuelve a   DeadLetterQueue
    FIN         paso 3         |
                               v
                              FIN
```

## Configuracion de Colas (Redis)

```typescript
// Estructura de colas en Redis

// Cola principal por prioridad
ZADD scheduler:queue:priority <score> <jobId>
// Score = timestamp - (priority * 1000000)

// Cola de jobs delayed
ZADD scheduler:queue:delayed <executeAt> <jobId>

// Jobs en proceso (para detectar workers caidos)
HSET scheduler:processing <jobId> <workerId>

// Registro de workers
HSET scheduler:workers <workerId> { lastHeartbeat, capabilities, currentJob }

// Metricas en tiempo real
INCR scheduler:metrics:processed
INCR scheduler:metrics:failed
```

## Estrategia de Reintentos

```typescript
interface RetryStrategy {
  maxRetries: number;
  retryDelay: number;      // Base delay en ms
  backoffMultiplier: number; // Multiplicador exponencial
  maxDelay: number;         // Delay maximo
}

// Calculo del delay
function calculateDelay(attempt: number, strategy: RetryStrategy): number {
  const delay = strategy.retryDelay * Math.pow(strategy.backoffMultiplier, attempt);
  return Math.min(delay, strategy.maxDelay);
}

// Ejemplo: { maxRetries: 5, retryDelay: 1000, backoffMultiplier: 2, maxDelay: 60000 }
// Intento 1: 1s
// Intento 2: 2s
// Intento 3: 4s
// Intento 4: 8s
// Intento 5: 16s
```

## Docker Compose

```yaml
version: '3.8'

services:
  api:
    build:
      context: .
      dockerfile: docker/Dockerfile
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/scheduler
      - REDIS_URL=redis://redis:6379
      - NODE_ENV=production
    depends_on:
      - db
      - redis
    restart: unless-stopped

  worker:
    build:
      context: .
      dockerfile: docker/Dockerfile.worker
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/scheduler
      - REDIS_URL=redis://redis:6379
      - WORKER_CONCURRENCY=5
    depends_on:
      - db
      - redis
      - api
    deploy:
      replicas: 2
    restart: unless-stopped

  scheduler:
    build:
      context: .
      dockerfile: docker/Dockerfile
    command: npm run scheduler
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/scheduler
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      - redis
    restart: unless-stopped

  db:
    image: postgres:15-alpine
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=scheduler
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"

volumes:
  postgres_data:
  redis_data:
```

## Arquitectura de la API

### Decisiones Tecnicas

| Aspecto | Decision | Razon |
|---------|----------|-------|
| Framework | Express 5 | Soporte nativo async/await, ecosystem maduro, ya instalado |
| Arquitectura | Clean Architecture | Separacion clara de responsabilidades, testeable, mantenible |
| Inyeccion de Dependencias | Manual/Factory | Sin magia, explicito, sin dependencias adicionales |
| Respuestas HTTP | Directo + headers | RESTful, body limpio, metadata en headers |
| Versionado | URL path `/api/v1/*` | Explicito, facil de rutear y documentar |
| Logging | pino | JSON estructurado, rapido, ideal para produccion |
| Validacion | Zod | Type-safe, excelente inferencia TS, mensajes claros |

### Estructura de Directorios (Detallada)

```
src/
├── api/                          # Capa de presentacion (HTTP)
│   ├── controllers/              # Handlers de requests
│   │   ├── job.controller.ts     # JobController class
│   │   ├── schedule.controller.ts
│   │   ├── worker.controller.ts
│   │   ├── metrics.controller.ts
│   │   └── index.ts              # Barrel export
│   │
│   ├── routes/                   # Definicion de rutas
│   │   ├── v1/                   # Versionado de API
│   │   │   ├── job.routes.ts
│   │   │   ├── schedule.routes.ts
│   │   │   ├── metrics.routes.ts
│   │   │   └── index.ts          # Router v1 agregado
│   │   └── index.ts              # Router principal
│   │
│   ├── middlewares/              # Middlewares de Express
│   │   ├── error.middleware.ts   # Manejo centralizado de errores
│   │   ├── validate.middleware.ts # Validacion con Zod
│   │   ├── requestId.middleware.ts # Genera X-Request-Id
│   │   ├── logger.middleware.ts  # Log de requests con pino
│   │   └── index.ts
│   │
│   ├── validators/               # Schemas Zod para validacion
│   │   ├── job.validator.ts      # createJobSchema, updateJobSchema, etc.
│   │   ├── schedule.validator.ts
│   │   ├── common.validator.ts   # paginationSchema, uuidSchema, etc.
│   │   └── index.ts
│   │
│   └── server.ts                 # Configuracion Express app
│
├── services/                     # Capa de logica de negocio
│   ├── job.service.ts            # JobService class
│   ├── schedule.service.ts
│   ├── worker.service.ts
│   ├── metrics.service.ts
│   └── index.ts
│
├── repositories/                 # Capa de acceso a datos
│   ├── job.repository.ts         # JobRepository (Prisma) - implementado
│   ├── worker.repository.ts      # WorkerRepository - implementado
│   ├── schedule.repository.ts
│   ├── deadLetter.repository.ts
│   └── index.ts
│
├── domain/                       # Entidades y tipos de dominio
│   ├── entities/                 # Tipos/interfaces de entidades
│   │   ├── job.entity.ts
│   │   ├── schedule.entity.ts
│   │   └── worker.entity.ts
│   │
│   ├── enums/                    # Enums del dominio
│   │   ├── job-status.enum.ts
│   │   ├── job-priority.enum.ts
│   │   └── index.ts
│   │
│   └── errors/                   # Errores de dominio
│       ├── app.error.ts          # Clase base AppError
│       ├── job.errors.ts         # JobNotFoundError, etc.
│       ├── validation.errors.ts
│       └── index.ts
│
├── infrastructure/               # Implementaciones externas
│   ├── database/
│   │   ├── prisma.client.ts      # Singleton PrismaClient
│   │   └── index.ts
│   │
│   ├── redis/
│   │   ├── redis.client.ts       # Cliente Redis (ya existe)
│   │   └── index.ts
│   │
│   └── logger/
│       ├── pino.logger.ts        # Configuracion pino
│       └── index.ts
│
├── config/                       # Configuracion centralizada
│   ├── index.ts                  # Export config object
│   ├── env.ts                    # Validacion de env vars con Zod
│   ├── database.config.ts
│   ├── redis.config.ts
│   ├── server.config.ts
│   └── queue.config.ts
│
├── shared/                       # Utilidades compartidas
│   ├── types/                    # Tipos globales
│   │   ├── http.types.ts         # Request, Response types
│   │   └── index.ts
│   │
│   ├── utils/
│   │   ├── id.utils.ts           # Generacion de IDs
│   │   └── index.ts
│   │
│   └── constants/
│       ├── http-status.ts        # HTTP status codes
│       └── index.ts
│
├── core/                         # Logica core del scheduler
│   ├── queue/
│   │   ├── QueueManager.ts       # Abstraccion sobre Redis (implementado)
│   │   └── index.ts
│   ├── scheduler/
│   ├── worker/
│   └── job/
│
├── container.ts                  # Factory/Container para DI
└── app.ts                        # Entry point principal
```

### Flujo de una Request

```
Request HTTP
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  Express App (server.ts)                                │
│  ├── requestId.middleware (genera X-Request-Id)         │
│  ├── logger.middleware (log entrada con pino)           │
│  ├── express.json() (parsea body)                       │
│  └── routes                                             │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  Router /api/v1/jobs                                    │
│  ├── validate.middleware(createJobSchema)               │
│  │   └── Si falla: throw ValidationError                │
│  └── jobController.create                               │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  JobController.create(req, res, next)                   │
│  ├── Extrae datos validados de req.body                 │
│  ├── Llama a jobService.create(data)                    │
│  ├── Si exito: res.status(201).json(job)                │
│  └── Si error: next(error)                              │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  JobService.create(data)                                │
│  ├── Aplica logica de negocio                           │
│  ├── Llama a jobRepository.create(job)                  │
│  └── Retorna Job creado                                 │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  JobRepository.create(job)                              │
│  ├── prisma.job.create({ data: job })                   │
│  └── Retorna Job de DB                                  │
└─────────────────────────────────────────────────────────┘
    │
    ▼
Response (JSON) + Headers (X-Request-Id, X-Response-Time)
```

### Sistema de Errores

```typescript
// domain/errors/app.error.ts
export class AppError extends Error {
  constructor(
    public readonly message: string,
    public readonly statusCode: number = 500,
    public readonly code: string = 'INTERNAL_ERROR',
    public readonly details?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details && { details: this.details }),
      },
    };
  }
}

// Errores especificos heredan de AppError
export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} with id '${id}' not found`, 404, 'NOT_FOUND');
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown) {
    super('Validation failed', 400, 'VALIDATION_ERROR', details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}
```

### Middleware de Errores

```typescript
// api/middlewares/error.middleware.ts
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = req.headers['x-request-id'];

  if (err instanceof AppError) {
    req.log.warn({ err, requestId }, err.message);
    res.status(err.statusCode).json(err.toJSON());
    return;
  }

  // Error no controlado
  req.log.error({ err, requestId }, 'Unhandled error');
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}
```

### Validacion con Zod

```typescript
// api/validators/job.validator.ts
import { z } from 'zod';

export const createJobSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(255),
    type: z.string().min(1).max(100),
    payload: z.record(z.unknown()).default({}),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']).default('NORMAL'),
    scheduledAt: z.coerce.date().optional(),
    webhookUrl: z.string().url().optional(),
    maxRetries: z.number().int().min(0).max(10).default(3),
    retryDelay: z.number().int().min(100).max(3600000).default(1000),
  }),
});

export const getJobsSchema = z.object({
  query: z.object({
    status: z.enum(['PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETRYING', 'CANCELLED']).optional(),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']).optional(),
    type: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
});

export const jobIdSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

// Inferir tipos de los schemas
export type CreateJobInput = z.infer<typeof createJobSchema>['body'];
export type GetJobsQuery = z.infer<typeof getJobsSchema>['query'];
```

### Middleware de Validacion

```typescript
// api/middlewares/validate.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError } from 'zod';
import { ValidationError } from '../../domain/errors';

export function validate(schema: AnyZodObject) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        }));
        next(new ValidationError(details));
      } else {
        next(error);
      }
    }
  };
}
```

### Factory/Container para DI

```typescript
// container.ts
import { PrismaClient } from './generated/prisma';
import { getRedisClient } from './infrastructure/redis';
import { JobRepository } from './repositories/job.repository';
import { JobService } from './services/job.service';
import { JobController } from './api/controllers/job.controller';
import { logger } from './infrastructure/logger';

export interface Container {
  prisma: PrismaClient;
  redis: Awaited<ReturnType<typeof getRedisClient>>;
  logger: typeof logger;

  // Repositories
  jobRepository: JobRepository;

  // Services
  jobService: JobService;

  // Controllers
  jobController: JobController;
}

export async function createContainer(): Promise<Container> {
  // Infraestructura
  const prisma = new PrismaClient();
  const redis = await getRedisClient();

  // Repositories
  const jobRepository = new JobRepository(prisma);

  // Services
  const jobService = new JobService(jobRepository, logger);

  // Controllers
  const jobController = new JobController(jobService);

  return {
    prisma,
    redis,
    logger,
    jobRepository,
    jobService,
    jobController,
  };
}

// Cleanup
export async function destroyContainer(container: Container): Promise<void> {
  await container.prisma.$disconnect();
  await container.redis.quit();
}
```

### Worker y JobProcessor (Implementado)

El Worker es un proceso que consume jobs de la cola y los ejecuta:

```typescript
// core/worker/Worker.ts

// Configuracion del worker
interface WorkerConfig {
  name: string;              // Identificador del worker
  concurrency: number;       // Jobs en paralelo (futuro)
  pollIntervalMs: number;    // Intervalo de polling (1000ms)
  heartbeatIntervalMs: number; // Heartbeat (30000ms)
  promoteIntervalMs: number;   // Promover delayed jobs (5000ms)
}

// Lifecycle del Worker:
// 1. start() - Registra en PostgreSQL, inicia timers, loop principal
// 2. loop() - Consume jobs: dequeue() -> findById() -> process()
// 3. stop() - Detiene timers, marca como stopped en PostgreSQL

// Caracteristicas:
// - Heartbeat periodico para detectar workers muertos
// - Promocion automatica de delayed jobs
// - Manejo de senales SIGTERM/SIGINT para shutdown graceful
// - Estadisticas de jobs procesados/fallidos
```

El JobProcessor ejecuta cada job y maneja el lifecycle:

```typescript
// core/worker/JobProcessor.ts

// Registro de handlers por tipo de job
processor.registerHandler('email.send', async (job) => {
  // Logica del job
  return { sent: true };
});

// Flujo de procesamiento:
// 1. Buscar handler para job.type
// 2. Marcar job como PROCESSING
// 3. Ejecutar handler
// 4. Si exito: COMPLETED + webhook
// 5. Si error y quedan reintentos: RETRYING + requeue con delay
// 6. Si error sin reintentos: FAILED + DLQ + webhook

// Backoff exponencial para reintentos:
// delay = baseDelay * multiplier^retryCount
// Ejemplo: 1s -> 2s -> 4s -> 8s -> 16s
```

**Ejecucion del Worker:**

```bash
pnpm worker  # Inicia proceso worker
```

### QueueManager (Implementado)

El QueueManager es la abstraccion sobre Redis para gestionar las colas de jobs:

```typescript
// core/queue/QueueManager.ts

// Claves Redis utilizadas
const QUEUE_KEYS = {
  PRIORITY: 'scheduler:queue:priority',    // Cola principal (Sorted Set)
  DELAYED: 'scheduler:queue:delayed',      // Jobs diferidos (Sorted Set)
  PROCESSING: 'scheduler:processing',      // Jobs en proceso (Hash)
  DEAD_LETTER: 'scheduler:queue:dlq',      // Dead Letter Queue (Sorted Set)
};

// Calculo de score para prioridad (menor = mayor prioridad)
const PRIORITY_SCORES = {
  CRITICAL: 0,
  HIGH:     1_000_000,
  NORMAL:   2_000_000,
  LOW:      3_000_000,
};

// Score = timestamp - PRIORITY_OFFSET
// Esto asegura que CRITICAL siempre se procesa antes que LOW
```

**Metodos disponibles:**

| Metodo | Descripcion |
|--------|-------------|
| `enqueue(jobId, priority)` | Encola job en priority queue con score calculado |
| `enqueueDelayed(jobId, scheduledAt, priority)` | Encola job para ejecucion futura |
| `dequeue()` | Obtiene y remueve el siguiente job (ZPOPMIN) |
| `promoteDelayedJobs()` | Mueve delayed jobs listos a priority queue |
| `markProcessing(jobId, workerId)` | Registra job en proceso |
| `markCompleted(jobId)` | Remueve job de processing |
| `moveToDLQ(jobId, reason)` | Mueve job fallido a Dead Letter Queue |
| `requeue(jobId, priority, delayMs)` | Re-encola job para reintento con delay |
| `getStats()` | Retorna conteo de todas las colas |

**Integracion con JobService:**

```typescript
// Al crear un job, se encola automaticamente
async create(input: CreateJobInput): Promise<Job> {
  const job = await this.jobRepository.create(input);

  if (job.scheduledAt && job.scheduledAt > new Date()) {
    await this.queueManager.enqueueDelayed(job.id, job.scheduledAt, job.priority);
  } else {
    await this.queueManager.enqueue(job.id, job.priority);
  }

  return this.jobRepository.updateStatus(job.id, 'QUEUED');
}
```

### Configuracion con Zod

```typescript
// config/env.ts
import { z } from 'zod';

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Queue
  QUEUE_PREFIX: z.string().default('scheduler'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Invalid environment variables:');
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
}

export const env = validateEnv();
```

### Headers de Respuesta

```typescript
// api/middlewares/responseHeaders.middleware.ts
export function responseHeaders(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    res.setHeader('X-Response-Time', `${duration}ms`);
  });

  // El X-Request-Id ya viene del requestId middleware
  next();
}
```

### Ejemplo de Controller

```typescript
// api/controllers/job.controller.ts
import { Request, Response, NextFunction } from 'express';
import { JobService } from '../../services/job.service';
import { CreateJobInput, GetJobsQuery } from '../validators/job.validator';

export class JobController {
  constructor(private readonly jobService: JobService) {}

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = req.body as CreateJobInput;
      const job = await this.jobService.create(data);

      res.status(201).json(job);
    } catch (error) {
      next(error);
    }
  };

  findAll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as GetJobsQuery;
      const { jobs, total } = await this.jobService.findAll(query);

      // Metadata en headers
      res.setHeader('X-Total-Count', total);
      res.setHeader('X-Page', query.page);
      res.setHeader('X-Limit', query.limit);
      res.setHeader('X-Total-Pages', Math.ceil(total / query.limit));

      res.json(jobs);
    } catch (error) {
      next(error);
    }
  };

  findById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const job = await this.jobService.findById(id);

      res.json(job);
    } catch (error) {
      next(error);
    }
  };

  cancel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const job = await this.jobService.cancel(id);

      res.json(job);
    } catch (error) {
      next(error);
    }
  };

  retry = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const job = await this.jobService.retry(id);

      res.json(job);
    } catch (error) {
      next(error);
    }
  };

  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      await this.jobService.delete(id);

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };
}
```

### Ejemplo de Rutas

```typescript
// api/routes/v1/job.routes.ts
import { Router } from 'express';
import { JobController } from '../../controllers/job.controller';
import { validate } from '../../middlewares/validate.middleware';
import { createJobSchema, getJobsSchema, jobIdSchema } from '../../validators/job.validator';

export function createJobRouter(controller: JobController): Router {
  const router = Router();

  router.post('/', validate(createJobSchema), controller.create);
  router.get('/', validate(getJobsSchema), controller.findAll);
  router.get('/:id', validate(jobIdSchema), controller.findById);
  router.delete('/:id', validate(jobIdSchema), controller.delete);
  router.post('/:id/cancel', validate(jobIdSchema), controller.cancel);
  router.post('/:id/retry', validate(jobIdSchema), controller.retry);

  return router;
}
```

## Componentes de Reliability (Fase 4)

### Dead Letter Queue (DLQ)

La Dead Letter Queue almacena jobs que han fallado permanentemente (excedieron reintentos):

```typescript
// Flujo de DLQ
Job fallido (maxRetries alcanzado)
    |
    v
1. JobProcessor.handleFailure()
    |
    v
2. deadLetterRepository.create() - Persiste en PostgreSQL
    |
    v
3. queueManager.moveToDLQ() - Marca en Redis
    |
    v
4. webhookDispatcher.dispatch() - Notifica via webhook (si configurado)
```

**Repositorio:** `src/repositories/dead-letter.repository.ts`
**Servicio:** `src/services/dead-letter.service.ts`
**Controller:** `src/api/controllers/dead-letter.controller.ts`

### OrphanJobRecovery

Detecta y recupera jobs huerfanos de workers caidos:

```typescript
// Configuracion por defecto
const config = {
  checkIntervalMs: 60000,    // Verificar cada 60 segundos
  staleThresholdMs: 90000,   // Worker stale si heartbeat > 90s
  recoveryDelayMs: 5000,     // Re-encolar con delay de 5s
};

// Flujo de recuperacion
1. findStaleWorkers() - Workers con lastHeartbeat > threshold
    |
    v
2. Para cada stale worker:
   - Buscar jobs en PROCESSING asignados al worker
   - Actualizar job: status=RETRYING, retryCount++, workerId=null
   - markCompleted() en Redis (limpiar processing)
   - requeue() con delay
   - stop() worker en PostgreSQL
```

**Ubicacion:** `src/core/worker/OrphanJobRecovery.ts`

### WebhookDispatcher

Envio de webhooks con reintentos y cola persistente:

```typescript
// Configuracion por defecto
const config = {
  timeoutMs: 10000,    // Timeout de 10 segundos
  maxAttempts: 3,      // Maximo 3 intentos
};

// Payload de webhook
interface WebhookPayload {
  jobId: string;
  jobType: string;
  status: 'completed' | 'failed';
  result?: unknown;
  error?: string;
  completedAt: string;
}

// Headers enviados
{
  'Content-Type': 'application/json',
  'X-Webhook-Event': 'job.status',
  'X-Job-Id': '<job-id>'
}
```

**Ubicacion:** `src/core/webhook/WebhookDispatcher.ts`

### WebhookRetryProcessor

Procesa reintentos de webhooks fallidos con backoff exponencial:

```typescript
// Configuracion por defecto
const config = {
  retryIntervalMs: 30000,  // Verificar cada 30 segundos
  baseDelayMs: 1000,       // Delay base para backoff
  maxDelayMs: 300000,      // Delay maximo: 5 minutos
};

// Formula de backoff exponencial
delay = min(baseDelay * 2^attempts, maxDelay)
// Ejemplo: 1s -> 2s -> 4s -> 8s -> ... -> 300s (max)
```

**Ubicacion:** `src/core/webhook/WebhookRetryProcessor.ts`

### MetricsService

Servicio centralizado de metricas y health checks:

```typescript
// Metricas disponibles
interface SystemOverview {
  queues: QueueStats;      // Conteo de colas Redis
  workers: WorkerStats;    // Estados y contadores de workers
  jobs: JobStats;          // Total, por status, ultimas 24h
  schedules: ScheduleStats; // Total, enabled/disabled, runs
  uptime: number;          // Uptime en segundos
}

// Health Status
type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';
// healthy: Todo OK
// degraded: BD/Redis OK pero sin workers activos
// unhealthy: BD o Redis fallando
```

**Ubicacion:** `src/services/metrics.service.ts`

### Modelo WebhookEvent (Prisma)

```prisma
model WebhookEvent {
  id            String    @id @default(uuid())
  jobId         String
  jobType       String
  url           String
  payload       Json
  status        String    @default("pending")  // pending, success, failed
  attempts      Int       @default(0)
  maxAttempts   Int       @default(3)
  lastStatusCode Int?
  lastError     String?
  lastAttemptAt DateTime?
  createdAt     DateTime  @default(now())
  completedAt   DateTime?

  @@index([status])
  @@index([jobId])
  @@map("webhook_events")
}
```

## Fases de Implementacion

### Fase 1: Core (Fundamentos)
- [x] Setup proyecto (TypeScript 5.9, ESLint, Prettier, Vitest)
- [x] Configuracion Docker Compose (PostgreSQL 15, Redis 7)
- [x] Prisma schema y migraciones
- [x] Conexion Redis
- [x] Configurar MCP (PostgreSQL) para consultas directas desde Claude
- [x] API basica (Express 5)
- [x] CRUD de Jobs (validators, repository, service, controller, routes)

### Fase 2: Queue System
- [x] QueueManager con Redis
- [x] PriorityQueue
- [x] DelayedQueue
- [x] Worker basico (single process)
- [x] JobProcessor con lifecycle

### Fase 3: Scheduling
- [x] CronParser (usando librería croner)
- [x] ScheduleExecutor (loop que verifica nextRunAt cada 10s)
- [x] CRUD de Schedules (validators, repository, service, controller, routes)
- [x] Trigger manual de schedules (`POST /api/v1/schedules/:id/trigger`)
- [x] Tests unitarios (36 tests: CronParser + ScheduleService)

### Fase 4: Reliability
- [x] Dead Letter Queue completa (API CRUD + persistencia PostgreSQL)
- [x] Recuperacion automatica de jobs huerfanos (OrphanJobRecovery)
- [x] Webhooks completos con reintentos y cola persistente
- [x] Health checks mejorados (/health/live, /health/ready)
- [x] Metricas y estadisticas (API /api/v1/metrics/*)
- [x] Tests unitarios (72 tests totales)

### Fase 5: Scaling
- [ ] WorkerPool (multiples procesos)
- [ ] WebSocket para workers remotos
- [ ] Metricas y dashboard
- [ ] Health checks

### Fase 6: Production Ready
- [ ] Rate limiting
- [ ] Autenticacion (API keys)
- [ ] Logging estructurado
- [ ] Tests (unit, integration, e2e)
- [ ] Documentacion OpenAPI
- [ ] Organizacion de Handlers (`src/handlers/`) - registro centralizado de job handlers

## Consideraciones de Seguridad

1. **Autenticacion**: API keys con scopes (read, write, admin)
2. **Rate Limiting**: Por API key y por IP
3. **Validacion**: Zod schemas para todos los inputs
4. **Payload Size**: Limitar tamano de payloads (ej: 1MB)
5. **Webhooks**: Verificar URLs, timeouts, reintentos limitados
6. **Secrets**: Variables de entorno, nunca en codigo

## Metricas Clave (KPIs)

- **Queue Depth**: Jobs pendientes por prioridad
- **Processing Time**: Tiempo promedio de ejecucion
- **Wait Time**: Tiempo en cola antes de procesarse
- **Throughput**: Jobs/segundo procesados
- **Error Rate**: % de jobs fallidos
- **Worker Utilization**: % de tiempo activo de workers
