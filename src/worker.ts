import 'dotenv/config';
import { createContainer, destroyContainer } from './container.js';
import { Worker } from './core/worker/index.js';
import { env } from './config/env.js';

async function main() {
  const container = await createContainer();

  // Registrar handlers de prueba
  container.jobProcessor.registerHandler('test.echo', async (job) => {
    container.logger.info({ jobId: job.id, payload: job.payload }, 'Executing test.echo');
    return { echo: job.payload, processedAt: new Date().toISOString() };
  });

  container.jobProcessor.registerHandler('test.scheduled', async (job) => {
    container.logger.info({ jobId: job.id, payload: job.payload }, 'Executing test.scheduled');
    return { message: 'Schedule executed successfully', payload: job.payload, executedAt: new Date().toISOString() };
  });

  const worker = new Worker(
    container.jobRepository,
    container.workerRepository,
    container.queueManager,
    container.jobProcessor,
    container.logger,
    {
      name: `worker-${String(process.pid)}`,
      concurrency: env.WORKER_CONCURRENCY,
    }
  );

  // Iniciar recuperación de jobs huérfanos
  container.orphanJobRecovery.start();

  // Iniciar procesador de reintentos de webhooks
  container.webhookRetryProcessor.start();

  // =======================================
  // Manejar errores no capturados
  process.on('unhandledRejection', (error) => {
    container.logger.fatal({ error }, 'Unhandled rejection');
    container.orphanJobRecovery.stop();
    container.webhookRetryProcessor.stop();
    destroyContainer(container)
      .then(() => process.exit(1))
      .catch(() => process.exit(1));
  });

  await worker.start();
}

main().catch((error: unknown) => {
  console.error('Failed to start worker:', error);
  process.exit(1);
});
