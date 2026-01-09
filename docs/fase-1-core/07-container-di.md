# Container de Inyección de Dependencias

## Implementación

**Archivo:** `src/container.ts`

```typescript
import { PrismaClient } from '@prisma/client';
import { getRedisClient, closeRedisConnection, logger } from './infrastructure/index.js';
import { QueueManager } from './core/queue/index.js';
import { JobProcessor } from './core/worker/JobProcessor.js';
import { JobRepository } from './repositories/job.repository.js';
import { WorkerRepository } from './repositories/worker.repository.js';
import { JobService } from './services/job.service.js';

export interface Container {
  prisma: PrismaClient;
  redis: Awaited<ReturnType<typeof getRedisClient>>;
  logger: typeof logger;
  queueManager: QueueManager;
  jobRepository: JobRepository;
  workerRepository: WorkerRepository;
  jobProcessor: JobProcessor;
  jobService: JobService;
}

export async function createContainer(): Promise<Container> {
  // 1. Infraestructura
  const prisma = new PrismaClient();
  const redis = await getRedisClient();

  // 2. Core
  const queueManager = new QueueManager(redis);

  // 3. Repositories
  const jobRepository = new JobRepository(prisma);
  const workerRepository = new WorkerRepository(prisma);

  // 4. Processors
  const jobProcessor = new JobProcessor(jobRepository, queueManager, logger);

  // 5. Services
  const jobService = new JobService(jobRepository, queueManager);

  logger.info('Container initialized');

  return {
    prisma,
    redis,
    logger,
    queueManager,
    jobRepository,
    workerRepository,
    jobProcessor,
    jobService,
  };
}

export async function destroyContainer(container: Container): Promise<void> {
  await container.prisma.$disconnect();
  await closeRedisConnection();
  container.logger.info('Container destroyed');
}
```

---

## Patrón Factory

El Container usa el patrón Factory para:

1. **Crear instancias** de todas las dependencias
2. **Inyectar dependencias** entre componentes
3. **Gestionar lifecycle** (creación y destrucción)

```
createContainer()
       │
       ├─► PrismaClient (BD)
       │
       ├─► RedisClient (Cache)
       │
       ├─► QueueManager(redis)
       │
       ├─► JobRepository(prisma)
       │
       ├─► WorkerRepository(prisma)
       │
       ├─► JobProcessor(jobRepo, queueManager, logger)
       │
       └─► JobService(jobRepo, queueManager)
```

---

## Ventajas

| Aspecto | Beneficio |
|---------|-----------|
| **Testeable** | Fácil inyectar mocks |
| **Explícito** | Sin magic/decoradores |
| **Type-safe** | TypeScript infiere tipos |
| **Lifecycle** | Control de creación/destrucción |
| **Singleton** | Una instancia por dependencia |

---

## Uso

### En API (server.ts)

```typescript
const container = await createContainer();
const app = createServer(container);

// Graceful shutdown
process.on('SIGTERM', async () => {
  await destroyContainer(container);
});
```

### En Worker (worker.ts)

```typescript
const container = await createContainer();

const worker = new Worker(
  container.jobRepository,
  container.workerRepository,
  container.queueManager,
  container.jobProcessor,
  container.logger,
  { name: `worker-${process.pid}` }
);

await worker.start();
```

---

## Errores de Dominio

**Archivo:** `src/domain/errors/http.errors.ts`

```typescript
import { AppError } from './app.error.js';

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} with id '${id}' not found`, 404, 'NOT_FOUND');
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(message, 400, 'BAD_REQUEST');
  }
}

export class ValidationError extends AppError {
  constructor(details: Record<string, string>) {
    super('Validation failed', 400, 'VALIDATION_ERROR', details);
  }
}
```

La clase base `AppError`:

```typescript
export class AppError extends Error {
  constructor(
    public readonly message: string,
    public readonly statusCode: number = 500,
    public readonly code: string = 'INTERNAL_ERROR',
    public readonly details?: Record<string, string>
  ) {
    super(message);
    this.name = this.constructor.name;
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
```
