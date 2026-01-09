# API Express

## Server

**Archivo:** `src/api/server.ts`

```typescript
import express, { type Express } from 'express';
import { httpLogger } from './middlewares/logger.middleware.js';
import { requestId } from './middlewares/requestId.middleware.js';
import { errorHandler } from './middlewares/error.middleware.js';
import { createApiV1Router } from './routes/v1/index.js';
import type { Container } from '../container.js';

export function createServer(container: Container): Express {
  const app = express();

  // Container disponible en app.locals
  app.locals.container = container;

  // Middlewares globales (orden importante)
  app.use(requestId);        // 1. Genera X-Request-Id
  app.use(httpLogger);       // 2. Log de requests
  app.use(express.json());   // 3. Parsea JSON

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Rutas API v1
  app.use('/api/v1', createApiV1Router(container));

  // Error handler (siempre al final)
  app.use(errorHandler);

  return app;
}
```

---

## Middlewares

### RequestId

**Archivo:** `src/api/middlewares/requestId.middleware.ts`

```typescript
import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = (req.headers['x-request-id'] as string) || randomUUID();
  req.headers['x-request-id'] = id;
  res.setHeader('X-Request-Id', id);
  next();
}
```

**Propósito:** Genera UUID único para tracing de requests.

### HTTP Logger (pino-http)

**Archivo:** `src/api/middlewares/logger.middleware.ts`

```typescript
import pinoHttp from 'pino-http';
import { logger } from '../../infrastructure/logger/index.js';

export const httpLogger = pinoHttp({
  logger,
  customProps: (req) => ({
    requestId: req.headers['x-request-id'],
  }),
});
```

**Propósito:** Log automático de todos los requests con timing.

### Error Handler

**Archivo:** `src/api/middlewares/error.middleware.ts`

```typescript
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../domain/errors/app.error.js';
import { logger } from '../../infrastructure/logger/index.js';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = req.headers['x-request-id'];

  if (err instanceof AppError) {
    logger.warn({ err, requestId }, err.message);
    res.status(err.statusCode).json(err.toJSON());
    return;
  }

  // Error no controlado
  logger.error({ err, requestId }, err.message);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}
```

**Propósito:** Manejo centralizado de errores, diferencia AppError de errores inesperados.

---

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/api/v1/jobs` | Crear job |
| GET | `/api/v1/jobs` | Listar jobs |
| GET | `/api/v1/jobs/:id` | Obtener job |
| PATCH | `/api/v1/jobs/:id` | Actualizar job |
| DELETE | `/api/v1/jobs/:id` | Eliminar job |
| POST | `/api/v1/jobs/:id/cancel` | Cancelar job |

---

## Entry Point

**Archivo:** `src/app.ts`

```typescript
import 'dotenv/config';
import { createContainer, destroyContainer } from './container.js';
import { createServer } from './api/server.js';
import { env } from './config/env.js';
import { logger } from './infrastructure/logger/index.js';

async function bootstrap() {
  const container = await createContainer();
  const app = createServer(container);

  const server = app.listen(env.PORT, env.HOST, () => {
    logger.info({ port: env.PORT, host: env.HOST }, 'Server started');
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');
    server.close();
    await destroyContainer(container);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
```
