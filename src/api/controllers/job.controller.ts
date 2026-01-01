import type { Request, Response, NextFunction } from 'express';
import type { JobService } from '../../services/job.service.js';
import {
  CreateJobSchema,
  UpdateJobSchema,
  ListJobsQuerySchema,
  JobIdParamSchema,
} from '../validators/job.validator.js';

export class JobController {
  constructor(private readonly jobService: JobService) {}

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = CreateJobSchema.parse(req.body);
      const job = await this.jobService.create(input);
      res.status(201).json(job);
    } catch (error) {
      next(error);
    }
  };
  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = JobIdParamSchema.parse(req.params);
      const job = await this.jobService.getById(id);
      res.json(job);
    } catch (error) {
      next(error);
    }
  };
  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = ListJobsQuerySchema.parse(req.query);
      const result = await this.jobService.list(query);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = JobIdParamSchema.parse(req.params);
      const input = UpdateJobSchema.parse(req.body);
      const job = await this.jobService.update(id, input);
      res.json(job);
    } catch (error) {
      next(error);
    }
  };
  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = JobIdParamSchema.parse(req.params);
      await this.jobService.delete(id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };
  cancel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = JobIdParamSchema.parse(req.params);
      const job = await this.jobService.cancel(id);
      res.json(job);
    } catch (error) {
      next(error);
    }
  };
}
