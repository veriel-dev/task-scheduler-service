import type { Express } from 'express';
import express from 'express';
import { requestId, httpLogger, errorHandler } from './middlewares/index.js';

export function createServer(): Express {
  const app = express();

  // Middleware globals
  app.use(requestId);
  app.use(httpLogger);
  app.use(express.json());

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // TODO: Rutas de API v1
  // app.use('/api/v1', v1Router);

  // Middleware de errores (siempre al final)
  app.use(errorHandler);
  return app;
}
