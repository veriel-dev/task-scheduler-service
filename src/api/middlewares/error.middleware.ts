import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../domain/errors/index.js';
import { logger } from '../../infrastructure/logger/index.js';

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.headers['x-request-id'];

  if (err instanceof AppError) {
    logger.warn({ err, requestId }, err.message);
    res.status(err.statusCode).json(err.toJSON());
    return;
  }
  const message = err instanceof Error ? err.message : 'Unknown error';
  logger.error({ err, requestId }, message);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}
