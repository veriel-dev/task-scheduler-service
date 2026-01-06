import { Router } from 'express';

import { ScheduleController } from '../../controllers/schedule.controller.js';
import type { Container } from '../../../container.js';

export function createScheduleRouter(container: Container): Router {
  const router = Router();

  const scheduleController = new ScheduleController(container.scheduleService);

  // CRUD básico
  router.post('/', scheduleController.create);
  router.get('/', scheduleController.list);
  router.get('/:id', scheduleController.getById);
  router.patch('/:id', scheduleController.update);
  router.delete('/:id', scheduleController.delete);

  // Acciones especiales
  router.post('/:id/enable', scheduleController.enable);
  router.post('/:id/disable', scheduleController.disable);
  router.post('/:id/trigger', scheduleController.trigger);
  router.get('/:id/next-runs', scheduleController.getNextRuns);

  return router;
}
