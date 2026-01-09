# Fase 1: Core (Fundamentos)

Esta documentación describe la implementación de los fundamentos del Task Scheduler Service.

## Contenido

1. [Setup del Proyecto](./01-setup-proyecto.md)
2. [Docker Compose](./02-docker-compose.md)
3. [Prisma ORM](./03-prisma-orm.md)
4. [Infraestructura](./04-infraestructura.md)
5. [API Express](./05-api-express.md)
6. [CRUD de Jobs](./06-crud-jobs.md)
7. [Container DI](./07-container-di.md)

## Resumen

La Fase 1 establece los cimientos del servicio:

| Componente | Tecnología | Estado |
|------------|------------|--------|
| Runtime | Node.js 20+ | ✅ |
| Lenguaje | TypeScript 5.9 | ✅ |
| Framework | Express 5 | ✅ |
| Base de datos | PostgreSQL 15 | ✅ |
| ORM | Prisma | ✅ |
| Cache/Colas | Redis 7 | ✅ |
| Validación | Zod | ✅ |
| Logging | Pino | ✅ |
| Testing | Vitest | ✅ |
| Contenedores | Docker Compose | ✅ |

## Arquitectura General

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT / API CONSUMER                     │
└──────────────────────────┬──────────────────────────────────┘
                           │
                    HTTP Requests
                           │
         ┌─────────────────▼──────────────────┐
         │    EXPRESS SERVER (src/app.ts)     │
         │  with Middleware & Error Handler   │
         └──────────┬──────────────────────────┘
                    │
         ┌──────────┴───────────┐
         │                      │
    ┌────▼──────┐        ┌─────▼────────┐
    │ Validators│        │  Controllers │
    │ (Zod)     │        │ (Job)        │
    └────┬──────┘        └─────┬────────┘
         │                      │
         └──────────┬───────────┘
                    │
         ┌──────────▼──────────┐
         │  Services           │
         │  (JobService)       │
         └──────────┬──────────┘
                    │
         ┌──────────┴──────────────────┐
         │                             │
    ┌────▼──────────┐        ┌────────▼────────┐
    │ JobRepository │        │ QueueManager    │
    │ (Prisma)      │        │ (Redis)         │
    └────┬──────────┘        └────────┬────────┘
         │                            │
    ┌────▼──────────┐        ┌────────▼────────┐
    │ PostgreSQL    │        │    Redis        │
    └───────────────┘        └─────────────────┘
```

## Estructura de Directorios

```
src/
├── api/                    # Capa de presentación HTTP
│   ├── controllers/        # Handlers de requests
│   ├── routes/             # Definición de rutas
│   ├── middlewares/        # RequestId, Logger, Error
│   ├── validators/         # Schemas Zod
│   └── server.ts           # Configuración Express
│
├── services/               # Lógica de negocio
│   └── job.service.ts
│
├── repositories/           # Acceso a datos
│   └── job.repository.ts
│
├── domain/                 # Entidades y errores
│   └── errors/
│
├── infrastructure/         # Implementaciones externas
│   ├── redis/
│   └── logger/
│
├── config/                 # Configuración
│   └── env.ts
│
├── container.ts            # Inyección de dependencias
└── app.ts                  # Entry point
```

## Comandos

```bash
# Desarrollo
pnpm dev                    # Servidor con hot-reload
pnpm lint                   # Verificar código
pnpm format                 # Formatear código

# Base de datos
pnpm prisma:migrate         # Ejecutar migraciones
pnpm prisma:generate        # Generar cliente
pnpm prisma:studio          # GUI de Prisma

# Docker
docker-compose up -d        # Iniciar servicios
docker-compose down         # Detener servicios
```
