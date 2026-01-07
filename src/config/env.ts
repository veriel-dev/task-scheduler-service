import { z } from 'zod';

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(300),
  HOST: z.string().default('0.0.0.0'),

  // Database
  DATABASE_URL: z.url(),

  // REDIS
  REDIS_URL: z.string().default('redis://loacalhost:6379'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // QUEUE
  QUEUE_PREFIX: z.string().default('scheduler'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),

  // SCHEDULER
  SCHEDULER_CHECK_INTERVAL_MS: z.coerce.number().int().min(1000).default(10000),
  SCHEDULER_DEFAULT_TIMEZONE: z.string().default('UTC'),

  // ORPHAN JOB RECOVERY
  ORPHAN_CHECK_INTERVAL_MS: z.coerce.number().int().min(10000).default(60000),
  ORPHAN_STALE_THRESHOLD_MS: z.coerce.number().int().min(30000).default(90000),
  ORPHAN_RECOVERY_DELAY_MS: z.coerce.number().int().min(1000).default(5000),

  // WEBHOOKS
  WEBHOOK_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10000),
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  WEBHOOK_RETRY_INTERVAL_MS: z.coerce.number().int().min(5000).default(30000),
  WEBHOOK_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(1000).default(5000),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.log('Invalid environment variables:');
    console.error(z.treeifyError(result.error));
    process.exit(1);
  }
  return result.data;
}

export const env = validateEnv();
