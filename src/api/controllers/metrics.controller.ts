import type { Request, Response, NextFunction } from 'express';
import type { MetricsService } from '../../services/metrics.service.js';

export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  getOverview = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const overview = await this.metricsService.getOverview();
      res.json(overview);
    } catch (error) {
      next(error);
    }
  };

  getQueueStats = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const stats = await this.metricsService.getQueueStats();
      res.json(stats);
    } catch (error) {
      next(error);
    }
  };

  getWorkerStats = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const stats = await this.metricsService.getWorkerStats();
      res.json(stats);
    } catch (error) {
      next(error);
    }
  };

  getJobStats = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const stats = await this.metricsService.getJobStats();
      res.json(stats);
    } catch (error) {
      next(error);
    }
  };

  getScheduleStats = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const stats = await this.metricsService.getScheduleStats();
      res.json(stats);
    } catch (error) {
      next(error);
    }
  };

  getHealth = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const health = await this.metricsService.getHealthStatus();
      const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
      res.status(statusCode).json(health);
    } catch (error) {
      next(error);
    }
  };
}
