import type { Request, Response, NextFunction } from 'express';
import type { ScheduleService } from '../../services/schedule.service.js';
import {
  CreateScheduleSchema,
  UpdateScheduleSchema,
  ListSchedulesQuerySchema,
  ScheduleIdParamSchema,
} from '../validators/schedule.validator.js';

export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = CreateScheduleSchema.parse(req.body);
      const schedule = await this.scheduleService.create(input);
      res.status(201).json(schedule);
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = ScheduleIdParamSchema.parse(req.params);
      const schedule = await this.scheduleService.getByIdWithJobs(id);
      res.json(schedule);
    } catch (error) {
      next(error);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = ListSchedulesQuerySchema.parse(req.query);
      const result = await this.scheduleService.list(query);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = ScheduleIdParamSchema.parse(req.params);
      const input = UpdateScheduleSchema.parse(req.body);
      const schedule = await this.scheduleService.update(id, input);
      res.json(schedule);
    } catch (error) {
      next(error);
    }
  };

  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = ScheduleIdParamSchema.parse(req.params);
      await this.scheduleService.delete(id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };

  enable = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = ScheduleIdParamSchema.parse(req.params);
      const schedule = await this.scheduleService.enable(id);
      res.json(schedule);
    } catch (error) {
      next(error);
    }
  };

  disable = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = ScheduleIdParamSchema.parse(req.params);
      const schedule = await this.scheduleService.disable(id);
      res.json(schedule);
    } catch (error) {
      next(error);
    }
  };

  trigger = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = ScheduleIdParamSchema.parse(req.params);
      const job = await this.scheduleService.trigger(id);
      res.status(201).json(job);
    } catch (error) {
      next(error);
    }
  };

  getNextRuns = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = ScheduleIdParamSchema.parse(req.params);
      const nextRuns = await this.scheduleService.getNextRuns(id, 10);
      res.json({ nextRuns });
    } catch (error) {
      next(error);
    }
  };
}
