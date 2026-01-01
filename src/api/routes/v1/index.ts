import { Router } from 'express';
import { createJobRouter } from './job.routes.js';
import type { Container } from '../../../container.js';

export function createApiV1Router(container: Container): Router {
  const router = Router();

  router.use('/jobs', createJobRouter(container));

  return router;
}
