import { Router } from 'express';

import { JobController } from '../../controllers/job.controller.js';
import type { Container } from '../../../container.js';

export function createJobRouter(container: Container): Router {
  const router = Router();

  const jobController = new JobController(container.jobService);

  router.post('/', jobController.create);
  router.get('/', jobController.list);
  router.get('/:id', jobController.getById);
  router.patch('/:id', jobController.update);
  router.delete('/:id', jobController.delete);
  router.post('/:id/cancel', jobController.cancel);

  return router;
}
