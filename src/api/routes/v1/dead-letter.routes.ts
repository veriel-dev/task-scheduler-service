import { Router } from 'express';
import { DeadLetterController } from '../../controllers/dead-letter.controller.js';
import type { Container } from '../../../container.js';

export function createDeadLetterRouter(container: Container): Router {
  const router = Router();
  const deadLetterController = new DeadLetterController(container.deadLetterService);

  router.get('/', deadLetterController.list);
  router.get('/stats', deadLetterController.getStats);
  router.get('/:id', deadLetterController.getById);
  router.post('/:id/retry', deadLetterController.retry);
  router.delete('/:id', deadLetterController.delete);

  return router;
}
