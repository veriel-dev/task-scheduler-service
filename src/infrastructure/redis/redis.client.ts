import { createClient, type RedisClientType } from 'redis';

let redisClient: RedisClientType | null = null;

export async function getRedisClient(): Promise<RedisClientType> {
  if (redisClient && redisClient.isOpen) {
    return redisClient;
  }

  const url = process.env.REDIS_URL || 'redis://localhost:6379';

  redisClient = createClient({ url });

  redisClient.on('error', (err) => {
    console.error('Redis Client Error:', err);
  });

  redisClient.on('connect', () => {
    console.log('Redis: Conectando...');
  });

  redisClient.on('ready', () => {
    console.log('Redis: Conexión establecida');
  });

  redisClient.on('reconnecting', () => {
    console.log('Redis: Reconectando...');
  });

  await redisClient.connect();

  return redisClient;
}

export async function closeRedisConnection(): Promise<void> {
  if (redisClient && redisClient.isOpen) {
    await redisClient.quit();
    redisClient = null;
    console.log('Redis: Conexión cerrada');
  }
}

export { redisClient };
