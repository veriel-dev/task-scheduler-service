import { z } from 'zod';
import { JobPrioritySchema } from './job.validator.js';
import { CronParser } from '../../core/scheduler/CronParser.js';

// Validador custom para expresiones cron
const cronExprSchema = z.string().refine((val) => CronParser.isValid(val), {
  message: 'Invalid cron expression',
});

// Validador custom para timezones
const timezoneSchema = z.string().refine((val) => CronParser.isValidTimezone(val), {
  message: 'Invalid timezone. Use IANA timezone format (e.g., "America/New_York")',
});

export const CreateScheduleSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().max(1000).optional(),
  cronExpr: cronExprSchema,
  timezone: timezoneSchema.default('UTC'),
  jobType: z.string().min(1, 'Job type is required').max(100),
  jobPayload: z.record(z.string(), z.unknown()).default({}),
  jobPriority: JobPrioritySchema.default('NORMAL'),
  enabled: z.boolean().default(true),
});

export const UpdateScheduleSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).nullable().optional(),
  cronExpr: cronExprSchema.optional(),
  timezone: timezoneSchema.optional(),
  jobType: z.string().min(1).max(100).optional(),
  jobPayload: z.record(z.string(), z.unknown()).optional(),
  jobPriority: JobPrioritySchema.optional(),
  enabled: z.boolean().optional(),
});

export const ListSchedulesQuerySchema = z.object({
  enabled: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const ScheduleIdParamSchema = z.object({
  id: z.uuid({ error: 'Invalid schedule ID' }),
});

export type CreateScheduleInput = z.infer<typeof CreateScheduleSchema>;
export type UpdateScheduleInput = z.infer<typeof UpdateScheduleSchema>;
export type ListSchedulesQuery = z.infer<typeof ListSchedulesQuerySchema>;
