import type { Express } from 'express';
import express from 'express';
import { requestId, httpLogger, errorHandler } from './middlewares/index.js';
import type { Container } from '../container.js';

export function createServer(container: Container): Express {
  const app = express();

  // Hacer el container accesible en lso requests
  app.locals.container = container;

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
