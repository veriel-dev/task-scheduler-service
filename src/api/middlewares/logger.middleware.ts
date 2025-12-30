import type { Request, Response, NextFunction } from 'express';

import { logger } from '../../infrastructure/logger/index.js';

export function httpLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const requestId = req.headers['x-request-id'];
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      requestId,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${String(duration)}ms`,
    };
    if (res.statusCode >= 400) {
      logger.warn(logData, `${req.method} ${req.url} ${String(res.statusCode)}`);
    } else {
      logger.info(logData, `${req.method} ${req.url} ${String(res.statusCode)}`);
    }
  });
  next();
}
