import { Router } from 'express';
import { createJobRouter } from './job.routes.js';
import { createScheduleRouter } from './schedule.routes.js';
import { createDeadLetterRouter } from './dead-letter.routes.js';
import { createMetricsRouter } from './metrics.routes.js';
import type { Container } from '../../../container.js';

export function createApiV1Router(container: Container): Router {
  const router = Router();

  router.use('/jobs', createJobRouter(container));
  router.use('/schedules', createScheduleRouter(container));
  router.use('/dead-letter', createDeadLetterRouter(container));
  router.use('/metrics', createMetricsRouter(container));

  return router;
}
