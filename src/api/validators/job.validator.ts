import { z } from 'zod';

export const JobPrioritySchema = z.enum(['CRITICAL', 'HIGH', 'NORMAL', 'LOW']);
export const JobStatusSchema = z.enum([
  'PENDING',
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'RETRYING',
  'CANCELLED',
]);

export const CreateJobSchema = z.object({
  name: z.string().min(1, 'Name is required').max(205),
  type: z.string().min(1, 'Type is required').max(100),
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

export const JobIdParamSchema = z.object({
  id: z.uuid({ error: 'Invalid job ID' }),
});

export type CreateJobInput = z.infer<typeof CreateJobSchema>;
export type UpdateJobInput = z.infer<typeof UpdateJobSchema>;
export type ListJobsQuery = z.infer<typeof ListJobsQuerySchema>;
