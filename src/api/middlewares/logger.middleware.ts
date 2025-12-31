import { pinoHttp } from 'pino-http';
import { logger } from '../../infrastructure/logger/index.js';

export const httpLogger = pinoHttp({
  logger,
  customProps: (req) => ({
    requestId: req.headers['x-request-id'],
  }),
});
