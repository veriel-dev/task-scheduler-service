import { z } from 'zod';

export const listDeadLetterSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    jobType: z.string().optional(),
  }),
});

export const deadLetterIdSchema = z.object({
  params: z.object({
    id: z.uuid(),
  }),
});

export type ListDeadLetterQuery = z.infer<typeof listDeadLetterSchema>['query'];
export type DeadLetterIdParams = z.infer<typeof deadLetterIdSchema>['params'];
