import { Router } from 'express';
import { MetricsController } from '../../controllers/metrics.controller.js';
import type { Container } from '../../../container.js';

export function createMetricsRouter(container: Container): Router {
  const router = Router();
  const metricsController = new MetricsController(container.metricsService);

  router.get('/overview', metricsController.getOverview);
  router.get('/queues', metricsController.getQueueStats);
  router.get('/workers', metricsController.getWorkerStats);
  router.get('/jobs', metricsController.getJobStats);
  router.get('/schedules', metricsController.getScheduleStats);

  return router;
}
