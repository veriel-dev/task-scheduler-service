# CRUD de Jobs

## Validadores (Zod)

**Archivo:** `src/api/validators/job.validator.ts`

```typescript
import { z } from 'zod';

export const JobPrioritySchema = z.enum(['CRITICAL', 'HIGH', 'NORMAL', 'LOW']);
export const JobStatusSchema = z.enum([
  'PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETRYING', 'CANCELLED'
]);

export const CreateJobSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.string().min(1).max(100),
  payload: z.record(z.string(), z.unknown()).default({}),
  priority: JobPrioritySchema.default('NORMAL'),
  maxRetries: z.number().int().min(0).max(10).default(3),
  retryDelay: z.number().int().min(100).max(3600000).default(1000),
  scheduledAt: z.coerce.date().optional(),
  webhookUrl: z.url().optional(),
});

export const UpdateJobSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  priority: JobPrioritySchema.optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  scheduledAt: z.coerce.date().nullable().optional(),
  webhookUrl: z.url().nullable().optional(),
});

export const ListJobsQuerySchema = z.object({
  status: JobStatusSchema.optional(),
  type: z.string().optional(),
  priority: JobPrioritySchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateJobInput = z.infer<typeof CreateJobSchema>;
export type UpdateJobInput = z.infer<typeof UpdateJobSchema>;
export type ListJobsQuery = z.infer<typeof ListJobsQuerySchema>;
```

---

## Repository

**Archivo:** `src/repositories/job.repository.ts`

```typescript
import type { PrismaClient, Job, JobStatus, Prisma } from '@prisma/client';

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export class JobRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateJobInput): Promise<Job> {
    return this.prisma.job.create({
      data: {
        name: input.name,
        type: input.type,
        payload: input.payload as Prisma.InputJsonValue,
        priority: input.priority,
        maxRetries: input.maxRetries,
        retryDelay: input.retryDelay,
        scheduledAt: input.scheduledAt,
        webhookUrl: input.webhookUrl,
      },
    });
  }

  async findById(id: string): Promise<Job | null> {
    return this.prisma.job.findUnique({ where: { id } });
  }

  async findMany(query: ListJobsQuery): Promise<PaginatedResult<Job>> {
    const { page, limit, status, type, priority } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.JobWhereInput = {};
    if (status) where.status = status;
    if (type) where.type = type;
    if (priority) where.priority = priority;

    const [data, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.job.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async updateStatus(id: string, status: JobStatus): Promise<Job> {
    return this.prisma.job.update({
      where: { id },
      data: { status },
    });
  }

  async updateInternal(id: string, data: Prisma.JobUpdateInput): Promise<Job> {
    return this.prisma.job.update({
      where: { id },
      data,
    });
  }

  async cancel(id: string): Promise<Job> {
    return this.prisma.job.update({
      where: { id },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });
  }

  async delete(id: string): Promise<Job> {
    return this.prisma.job.delete({ where: { id } });
  }
}
```

---

## Service

**Archivo:** `src/services/job.service.ts`

```typescript
import type { Job } from '@prisma/client';
import type { JobRepository, PaginatedResult } from '../repositories/job.repository.js';
import type { QueueManager } from '../core/queue/QueueManager.js';
import { NotFoundError, BadRequestError } from '../domain/errors/http.errors.js';

export class JobService {
  constructor(
    private readonly jobRepository: JobRepository,
    private readonly queueManager: QueueManager
  ) {}

  async create(input: CreateJobInput): Promise<Job> {
    const job = await this.jobRepository.create(input);

    // Encolar: delayed o priority queue
    if (job.scheduledAt && job.scheduledAt > new Date()) {
      await this.queueManager.enqueueDelayed(job.id, job.scheduledAt, job.priority);
    } else {
      await this.queueManager.enqueue(job.id, job.priority);
    }

    return this.jobRepository.updateStatus(job.id, 'QUEUED');
  }

  async getById(id: string): Promise<Job> {
    const job = await this.jobRepository.findById(id);
    if (!job) throw new NotFoundError('Job', id);
    return job;
  }

  async list(query: ListJobsQuery): Promise<PaginatedResult<Job>> {
    return this.jobRepository.findMany(query);
  }

  async update(id: string, input: UpdateJobInput): Promise<Job> {
    const job = await this.jobRepository.findById(id);
    if (!job) throw new NotFoundError('Job', id);

    // No permitir actualizar jobs en ejecución o completados
    if (['PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) {
      throw new BadRequestError(`Cannot update job with status '${job.status}'`);
    }

    return this.jobRepository.update(id, input);
  }

  async delete(id: string): Promise<void> {
    const job = await this.jobRepository.findById(id);
    if (!job) throw new NotFoundError('Job', id);

    if (job.status === 'PROCESSING') {
      throw new BadRequestError('Cannot delete a job that is processing');
    }

    await this.jobRepository.delete(id);
  }

  async cancel(id: string): Promise<Job> {
    const job = await this.jobRepository.findById(id);
    if (!job) throw new NotFoundError('Job', id);

    if (!['PENDING', 'QUEUED', 'RETRYING'].includes(job.status)) {
      throw new BadRequestError(`Cannot cancel job with status '${job.status}'`);
    }

    return this.jobRepository.cancel(id);
  }
}
```

---

## Controller

**Archivo:** `src/api/controllers/job.controller.ts`

```typescript
import type { Request, Response, NextFunction } from 'express';
import type { JobService } from '../../services/job.service.js';
import { CreateJobSchema, UpdateJobSchema, ListJobsQuerySchema, JobIdParamSchema } from '../validators/job.validator.js';

export class JobController {
  constructor(private readonly jobService: JobService) {}

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = CreateJobSchema.parse(req.body);
      const job = await this.jobService.create(input);
      res.status(201).json(job);
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = JobIdParamSchema.parse(req.params);
      const job = await this.jobService.getById(id);
      res.json(job);
    } catch (error) {
      next(error);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = ListJobsQuerySchema.parse(req.query);
      const result = await this.jobService.list(query);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = JobIdParamSchema.parse(req.params);
      const input = UpdateJobSchema.parse(req.body);
      const job = await this.jobService.update(id, input);
      res.json(job);
    } catch (error) {
      next(error);
    }
  };

  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = JobIdParamSchema.parse(req.params);
      await this.jobService.delete(id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };

  cancel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = JobIdParamSchema.parse(req.params);
      const job = await this.jobService.cancel(id);
      res.json(job);
    } catch (error) {
      next(error);
    }
  };
}
```

---

## Routes

**Archivo:** `src/api/routes/v1/job.routes.ts`

```typescript
import { Router } from 'express';
import { JobController } from '../../controllers/job.controller.js';
import type { Container } from '../../../container.js';

export function createJobRouter(container: Container): Router {
  const router = Router();
  const jobController = new JobController(container.jobService);

  router.post('/', jobController.create);
  router.get('/', jobController.list);
  router.get('/:id', jobController.getById);
  router.patch('/:id', jobController.update);
  router.delete('/:id', jobController.delete);
  router.post('/:id/cancel', jobController.cancel);

  return router;
}
```
