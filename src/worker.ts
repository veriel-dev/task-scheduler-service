import 'dotenv/config';
import { createContainer, destroyContainer } from './container.js';
import { Worker } from './core/worker/index.js';
import { env } from './config/env.js';

async function main() {
  const container = await createContainer();

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
  // =======================================
  // Manejar errores no capturados
  process.on('unhandledRejection', (error) => {
    container.logger.fatal({ error }, 'Unhandled rejection');
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
