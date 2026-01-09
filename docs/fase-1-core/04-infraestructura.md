# Infraestructura

## Cliente Redis

**Archivo:** `src/infrastructure/redis/redis.client.ts`

```typescript
import { createClient, type RedisClientType } from 'redis';

let redisClient: RedisClientType | null = null;

export async function getRedisClient(): Promise<RedisClientType> {
  if (redisClient && redisClient.isOpen) {
    return redisClient;
  }

  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  redisClient = createClient({ url });

  redisClient.on('error', (err) => console.error('Redis Error:', err));
  redisClient.on('ready', () => console.log('Redis: Conectado'));

  await redisClient.connect();
  return redisClient;
}

export async function closeRedisConnection(): Promise<void> {
  if (redisClient && redisClient.isOpen) {
    await redisClient.quit();
    redisClient = null;
  }
}
```

**Características:**
- Singleton lazy: una única conexión bajo demanda
- Reconnect automático por el cliente Redis
- Graceful shutdown con `quit()`

---

## Logger (Pino)

**Archivo:** `src/infrastructure/logger/pino.logger.ts`

```typescript
import pino from 'pino';
import { env } from '../../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  transport:
    env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            singleLine: true,
          },
        }
      : undefined,
  base: { env: env.NODE_ENV },
});
```

**Desarrollo:** Logs coloreados y legibles
**Producción:** JSON estructurado para agregación

---

## Configuración de Entorno

**Archivo:** `src/config/env.ts`

```typescript
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.url(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:');
    console.error(z.treeifyError(result.error));
    process.exit(1);
  }
  return result.data;
}

export const env = validateEnv();
```

**Fail-fast:** Si falta una variable requerida, el proceso termina inmediatamente.
