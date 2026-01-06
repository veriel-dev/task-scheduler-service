import 'dotenv/config';
import { createContainer, destroyContainer } from './container.js';

async function main() {
  const container = await createContainer();

  container.logger.info('Starting ScheduleExecutor...');

  // Manejar errores no capturados
  process.on('unhandledRejection', (error) => {
    container.logger.fatal({ error }, 'Unhandled rejection in scheduler');
    destroyContainer(container)
      .then(() => process.exit(1))
      .catch(() => process.exit(1));
  });

  // Iniciar el executor
  await container.scheduleExecutor.start();
}

main().catch((error: unknown) => {
  console.error('Failed to start scheduler:', error);
  process.exit(1);
});
