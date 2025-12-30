import 'dotenv/config';
import { getRedisClient, closeRedisConnection } from './infrastructure/redis/index.js';

console.log('Task Scheduler Service - Veriel.dev');

async function main(): Promise<void> {
  try {
    // Probar conexión a Redis
    const redis = await getRedisClient();

    // Test básico: SET y GET
    await redis.set('test:ping', 'pong');
    const result = await redis.get('test:ping');
    console.log(`Redis test: ${result as string}`);

    // Limpiar key de test
    await redis.del('test:ping');

    // Cerrar conexión
    await closeRedisConnection();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

await main();
