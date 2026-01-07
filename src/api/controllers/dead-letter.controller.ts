import type { Request, Response, NextFunction } from 'express';
import type { DeadLetterService } from '../../services/dead-letter.service.js';
import { listDeadLetterSchema, deadLetterIdSchema } from '../validators/dead-letter.validator.js';

export class DeadLetterController {
  constructor(private readonly deadLetterService: DeadLetterService) {}

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { query } = listDeadLetterSchema.parse({ query: req.query });
      const result = await this.deadLetterService.list(query);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { params } = deadLetterIdSchema.parse({ params: req.params });
      const deadLetterJob = await this.deadLetterService.getById(params.id);
      res.json(deadLetterJob);
    } catch (error) {
      next(error);
    }
  };

  retry = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { params } = deadLetterIdSchema.parse({ params: req.params });
      const newJob = await this.deadLetterService.retry(params.id);
      res.status(201).json({
        message: 'Job requeued successfully',
        newJob,
      });
    } catch (error) {
      next(error);
    }
  };

  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { params } = deadLetterIdSchema.parse({ params: req.params });
      await this.deadLetterService.delete(params.id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };

  getStats = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const stats = await this.deadLetterService.getStats();
      res.json(stats);
    } catch (error) {
      next(error);
    }
  };
}
