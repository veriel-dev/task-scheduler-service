import { Router } from 'express';

import { JobController } from '../../controllers/job.controller.js';
import { JobService } from '../../../services/job.service.js';
import { JobRepository } from '../../../repositories/job.repository.js';
import type { Container } from '../../../container.js';

export function createJobRouter(container: Container): Router {
  const router = Router();

  const jobRepository = new JobRepository(container.prisma);
  const jobService = new JobService(jobRepository, container.queueManager);
  const jobController = new JobController(jobService);

  router.post('/', jobController.create);
  router.get('/', jobController.list);
  router.get('/:id', jobController.getById);
  router.patch('/:id', jobController.update);
  router.delete('/:id', jobController.delete);
  router.post('/:id/cancel', jobController.cancel);

  return router;
}
