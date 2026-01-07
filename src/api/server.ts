import type { Express } from 'express';
import express from 'express';
import { requestId, httpLogger, errorHandler } from './middlewares/index.js';
import type { Container } from '../container.js';
import { createApiV1Router } from './routes/index.js';

export function createServer(container: Container): Express {
  const app = express();

  // Hacer el container accesible en los requests
  app.locals.container = container;

  // Middleware globals
  app.use(requestId);
  app.use(httpLogger);
  app.use(express.json());

  // Liveness check - simple check that app is running
  app.get('/health/live', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Readiness check - full system health
  app.get('/health/ready', async (_req, res) => {
    try {
      const health = await container.metricsService.getHealthStatus();
      const statusCode = health.status === 'unhealthy' ? 503 : 200;
      res.status(statusCode).json(health);
    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Legacy health endpoint (backwards compatible)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // API v1
  app.use('/api/v1', createApiV1Router(container));

  // Middleware de errores (siempre al final)
  app.use(errorHandler);
  return app;
}
