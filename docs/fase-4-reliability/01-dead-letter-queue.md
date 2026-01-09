# Dead Letter Queue (DLQ)

## Proposito

La Dead Letter Queue almacena jobs que han fallado permanentemente despues de agotar todos sus reintentos. Esto permite:

- **No perder jobs fallidos**: Se persisten en PostgreSQL para analisis posterior
- **Reintento manual**: Los operadores pueden reintentar jobs desde la DLQ
- **Analisis de errores**: Historial completo de fallos para debugging

## Flujo de DLQ

```
Job falla (retryCount >= maxRetries)
         │
         ▼
┌───────────────────────┐
│    JobProcessor       │
│    handleFailure()    │
└───────────┬───────────┘
            │
    ┌───────┴───────┐
    │               │
    ▼               ▼
┌───────────┐  ┌───────────┐
│  Prisma   │  │   Redis   │
│  create   │  │ moveToDLQ │
│  DLQ      │  │           │
└───────────┘  └───────────┘
            │
            ▼
┌───────────────────────┐
│   WebhookDispatcher   │
│ (si webhookUrl existe)│
└───────────────────────┘
```

## Modelo de Datos

```prisma
model DeadLetterJob {
  id               String      @id @default(uuid())
  originalJobId    String
  jobName          String
  jobType          String
  jobPayload       Json
  jobPriority      JobPriority
  failureReason    String
  failureCount     Int
  lastError        String?
  errorStack       String?
  workerId         String?
  originalCreatedAt DateTime
  failedAt         DateTime    @default(now())

  @@index([jobType])
  @@index([failedAt])
  @@map("dead_letter_jobs")
}
```

## API Endpoints

### Listar Jobs en DLQ

```http
GET /api/v1/dead-letter?page=1&limit=20&jobType=email.send
```

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "originalJobId": "uuid",
      "jobName": "Send Welcome Email",
      "jobType": "email.send",
      "jobPayload": { "to": "user@example.com" },
      "jobPriority": "NORMAL",
      "failureReason": "SMTP connection refused",
      "failureCount": 3,
      "lastError": "Error: ECONNREFUSED",
      "workerId": "worker-1",
      "failedAt": "2025-01-15T10:30:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20,
  "totalPages": 1
}
```

### Obtener Detalle

```http
GET /api/v1/dead-letter/:id
```

### Reintentar Job

```http
POST /api/v1/dead-letter/:id/retry
```

Crea un nuevo job con los datos del job fallido y lo elimina de la DLQ.

**Response:**
```json
{
  "id": "nuevo-uuid",
  "name": "Send Welcome Email (retry)",
  "type": "email.send",
  "status": "QUEUED",
  "priority": "NORMAL"
}
```

### Eliminar de DLQ

```http
DELETE /api/v1/dead-letter/:id
```

**Response:** 204 No Content

### Estadisticas

```http
GET /api/v1/dead-letter/stats
```

**Response:**
```json
{
  "total": 42,
  "byType": [
    { "jobType": "email.send", "count": 25 },
    { "jobType": "report.generate", "count": 17 }
  ],
  "oldest": "2025-01-10T00:00:00Z",
  "newest": "2025-01-15T10:30:00Z"
}
```

## Implementacion

### Repository

```typescript
// src/repositories/dead-letter.repository.ts

export class DeadLetterRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateDeadLetterInput): Promise<DeadLetterJob> {
    return this.prisma.deadLetterJob.create({ data: input });
  }

  async findById(id: string): Promise<DeadLetterJob | null> {
    return this.prisma.deadLetterJob.findUnique({ where: { id } });
  }

  async findMany(query: ListQuery): Promise<PaginatedResult<DeadLetterJob>> {
    const { page, limit, jobType } = query;
    const where = jobType ? { jobType } : {};

    const [data, total] = await Promise.all([
      this.prisma.deadLetterJob.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { failedAt: 'desc' },
      }),
      this.prisma.deadLetterJob.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async delete(id: string): Promise<DeadLetterJob> {
    return this.prisma.deadLetterJob.delete({ where: { id } });
  }

  async getStats(): Promise<DeadLetterStats> {
    const [total, byType, dates] = await Promise.all([
      this.prisma.deadLetterJob.count(),
      this.prisma.deadLetterJob.groupBy({
        by: ['jobType'],
        _count: { jobType: true },
      }),
      this.prisma.deadLetterJob.aggregate({
        _min: { failedAt: true },
        _max: { failedAt: true },
      }),
    ]);

    return {
      total,
      byType: byType.map(b => ({ jobType: b.jobType, count: b._count.jobType })),
      oldest: dates._min.failedAt,
      newest: dates._max.failedAt,
    };
  }
}
```

### Service

```typescript
// src/services/dead-letter.service.ts

export class DeadLetterService {
  async retry(id: string): Promise<Job> {
    const dlJob = await this.deadLetterRepository.findById(id);
    if (!dlJob) throw new NotFoundError('DeadLetterJob', id);

    // 1. Crear nuevo job
    const newJob = await this.jobRepository.create({
      name: `${dlJob.jobName} (retry)`,
      type: dlJob.jobType,
      payload: dlJob.jobPayload as Record<string, unknown>,
      priority: dlJob.jobPriority,
    });

    // 2. Encolar
    await this.queueManager.enqueue(newJob.id, newJob.priority);
    const queuedJob = await this.jobRepository.updateStatus(newJob.id, 'QUEUED');

    // 3. Eliminar de DLQ
    await this.deadLetterRepository.delete(id);
    await this.queueManager.removeFromDLQ(dlJob.originalJobId);

    return queuedJob;
  }
}
```

## Archivos Relacionados

| Archivo | Descripcion |
|---------|-------------|
| `src/repositories/dead-letter.repository.ts` | Acceso a datos |
| `src/services/dead-letter.service.ts` | Logica de negocio |
| `src/api/controllers/dead-letter.controller.ts` | HTTP handlers |
| `src/api/routes/v1/dead-letter.routes.ts` | Rutas |
| `src/api/validators/dead-letter.validator.ts` | Validacion Zod |

## Tests

```bash
pnpm test dead-letter.service.test
```

Cobertura:
- list() con paginacion y filtros
- getById() con error 404
- retry() creacion de nuevo job
- delete() con limpieza de Redis
- getStats() agregacion
