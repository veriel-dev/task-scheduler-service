# Task Scheduler Service

<div align="center">

![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-5.x-000000?style=for-the-badge&logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=for-the-badge&logo=redis&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

**Sistema de colas y tareas programadas con soporte para jobs diferidos, prioridades y recuperación automática**

[Características](#características) • [Arquitectura](#arquitectura) • [API](#api-endpoints) • [Testing](#testing)

</div>

---

## Descripción

Sistema de task scheduling y job queue construido desde cero. Implementa colas con prioridades, jobs diferidos, tareas programadas con expresiones cron, dead letter queue para fallos, webhooks con reintentos y recuperación automática de jobs huérfanos.

### Habilidades Demostradas

| Área | Competencias |
|------|--------------|
| **Backend** | Node.js, Express 5, TypeScript estricto, arquitectura modular |
| **Base de Datos** | PostgreSQL, Prisma ORM, migraciones, índices optimizados |
| **Colas** | Redis ZADD para priority queue, jobs diferidos con timestamp |
| **Scheduling** | Expresiones cron, ejecución programada, triggers manuales |
| **Reliability** | Dead Letter Queue, reintentos exponenciales, recovery automático |
| **Observabilidad** | Health checks, métricas en tiempo real, logging estructurado (Pino) |
| **Testing** | Vitest, tests unitarios, mocking de dependencias |

---

## Características

### Sistema de Colas
- **Priority Queue** con Redis ZADD (scoring por prioridad)
- **Delayed Queue** para jobs diferidos con timestamp
- Estados de job: `pending`, `processing`, `completed`, `failed`, `dead`
- Reintentos configurables con backoff exponencial

### Scheduling (Cron)
- Parser de expresiones cron completas
- Ejecución automática basada en `nextRunAt`
- Trigger manual de schedules
- Historial de ejecuciones

### Reliability
- **Dead Letter Queue (DLQ)** con persistencia en PostgreSQL
- Recuperación automática de jobs huérfanos
- Sistema de webhooks con reintentos exponenciales
- Health checks (`/health/live`, `/health/ready`)

### Observabilidad
- Métricas en tiempo real (jobs procesados, fallidos, tiempos)
- Logging estructurado con Pino
- Estadísticas por worker

---

## Tech Stack

### Core

| Tecnología | Versión | Propósito |
|------------|---------|-----------|
| **Node.js** | 20+ | Runtime |
| **TypeScript** | 5.9 | Tipado estricto |
| **Express** | 5.x | Framework HTTP |
| **Prisma** | 6.13 | ORM para PostgreSQL |
| **Redis** | 7.x | Queue storage |

### Librerías

| Librería | Propósito |
|----------|-----------|
| **croner** | Parser de expresiones cron |
| **zod** | Validación de schemas |
| **pino** | Logging estructurado |
| **vitest** | Testing framework |

### Infraestructura

| Servicio | Propósito |
|----------|-----------|
| **PostgreSQL** | Persistencia de jobs, schedules, DLQ |
| **Redis** | Cola en memoria, pub/sub |
| **Docker Compose** | Desarrollo local |

---

## Arquitectura

### Estructura del Proyecto

```
src/
├── api/                 # Capa HTTP
│   ├── controllers/     # Handlers de rutas
│   ├── routes/          # Definición de endpoints
│   ├── middlewares/     # Auth, validation, error handling
│   └── validators/      # Schemas Zod
├── core/                # Lógica principal
│   ├── job/             # JobProcessor, lifecycle de estados
│   ├── queue/           # QueueManager (Redis abstraction)
│   ├── scheduler/       # CronParser, ScheduleExecutor
│   ├── worker/          # Worker process
│   └── webhook/         # WebhookDispatcher con reintentos
├── services/            # Lógica de negocio
│   ├── job.service.ts
│   ├── schedule.service.ts
│   ├── metrics.service.ts
│   └── dead-letter.service.ts
├── repositories/        # Acceso a datos
│   ├── job.repository.ts
│   ├── schedule.repository.ts
│   └── dead-letter.repository.ts
├── domain/              # Entidades y tipos
│   ├── entities/
│   ├── enums/
│   └── errors/
├── infrastructure/      # Servicios externos
│   ├── redis/
│   ├── logger/
│   └── config/
├── app.ts               # Entry point API
├── worker.ts            # Entry point Worker
├── scheduler.ts         # Entry point Scheduler
└── container.ts         # Dependency Injection
```

### Modelos de Datos

```
┌─────────────────┐     ┌─────────────────┐
│      Job        │     │    Schedule     │
├─────────────────┤     ├─────────────────┤
│ id              │     │ id              │
│ type            │     │ name            │
│ payload         │     │ cronExpression  │
│ priority        │     │ jobType         │
│ status          │     │ payload         │
│ attempts        │     │ nextRunAt       │
│ maxRetries      │     │ enabled         │
│ scheduledFor    │     │ lastRunAt       │
│ processedAt     │     └─────────────────┘
│ failedReason    │
└─────────────────┘
         │
         ▼ (on max retries)
┌─────────────────┐     ┌─────────────────┐
│  DeadLetterJob  │     │  WebhookEvent   │
├─────────────────┤     ├─────────────────┤
│ id              │     │ id              │
│ originalJobId   │     │ jobId           │
│ payload         │     │ url             │
│ failedReason    │     │ status          │
│ attempts        │     │ attempts        │
│ movedAt         │     │ lastAttemptAt   │
└─────────────────┘     └─────────────────┘
```

### Flujo de Procesamiento

```
                    ┌─────────────┐
                    │   API/Cron  │
                    └──────┬──────┘
                           │ create job
                           ▼
┌──────────────────────────────────────────────┐
│                 Redis Queue                   │
│  ┌─────────┐  ┌─────────┐  ┌─────────────┐   │
│  │ Priority│  │ Delayed │  │   Standard  │   │
│  │  Queue  │  │  Queue  │  │    Queue    │   │
│  └─────────┘  └─────────┘  └─────────────┘   │
└──────────────────────┬───────────────────────┘
                       │ poll
                       ▼
              ┌─────────────────┐
              │     Worker      │
              │  (JobProcessor) │
              └────────┬────────┘
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
    ┌─────────┐  ┌──────────┐  ┌─────────┐
    │ Success │  │  Retry   │  │  Failed │
    │         │  │(backoff) │  │  (DLQ)  │
    └─────────┘  └──────────┘  └─────────┘
         │
         ▼
    ┌─────────────┐
    │   Webhook   │
    │  Dispatch   │
    └─────────────┘
```

---

## API Endpoints

### Jobs

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `POST` | `/api/jobs` | Crear nuevo job |
| `GET` | `/api/jobs` | Listar jobs (con filtros) |
| `GET` | `/api/jobs/:id` | Obtener job por ID |
| `DELETE` | `/api/jobs/:id` | Cancelar job pendiente |
| `POST` | `/api/jobs/:id/retry` | Reintentar job fallido |

### Schedules

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `POST` | `/api/schedules` | Crear schedule (cron) |
| `GET` | `/api/schedules` | Listar schedules |
| `PUT` | `/api/schedules/:id` | Actualizar schedule |
| `DELETE` | `/api/schedules/:id` | Eliminar schedule |
| `POST` | `/api/schedules/:id/trigger` | Ejecutar manualmente |

### Dead Letter Queue

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/dlq` | Listar jobs en DLQ |
| `POST` | `/api/dlq/:id/retry` | Reintentar desde DLQ |
| `DELETE` | `/api/dlq/:id` | Eliminar de DLQ |

### Health & Metrics

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/health/live` | Liveness check |
| `GET` | `/health/ready` | Readiness check |
| `GET` | `/api/metrics` | Estadísticas del sistema |

---

## Testing

```bash
pnpm test              # Ejecutar tests
pnpm test:watch        # Modo watch
```

### Cobertura

| Módulo | Tests |
|--------|-------|
| **CronParser** | Parsing de expresiones cron |
| **WebhookDispatcher** | Envío y reintentos |
| **OrphanJobRecovery** | Recuperación automática |
| **MetricsService** | Cálculo de estadísticas |
| **ScheduleService** | Lógica de schedules |
| **DeadLetterService** | Gestión de DLQ |
| **Total** | **125 test blocks** |

---

## Quick Start

### Requisitos
- Node.js 20+
- pnpm 10+
- Docker y Docker Compose

### Desarrollo Local

```bash
# Clonar e instalar
git clone https://github.com/veriel-dev/task-scheduler-service.git
cd task-scheduler-service
pnpm install

# Levantar PostgreSQL y Redis
docker-compose up -d

# Ejecutar migraciones
pnpm prisma migrate dev

# Iniciar servicios (en terminales separadas)
pnpm dev          # API Server
pnpm worker       # Worker process
pnpm scheduler    # Schedule executor
```

---

## Scripts

| Comando | Descripción |
|---------|-------------|
| `pnpm dev` | API en modo desarrollo |
| `pnpm worker` | Proceso worker |
| `pnpm scheduler` | Ejecutor de schedules |
| `pnpm build` | Compilar TypeScript |
| `pnpm test` | Ejecutar tests |
| `pnpm prisma migrate dev` | Ejecutar migraciones |
| `pnpm prisma generate` | Generar cliente Prisma |

---

## Roadmap

- [x] **Fase 1**: Setup TypeScript, Prisma, Express
- [x] **Fase 2**: Queue system con Redis (priority, delayed)
- [x] **Fase 3**: Scheduling con cron
- [x] **Fase 4**: Reliability (DLQ, webhooks, recovery)
- [ ] **Fase 5**: Worker pool, rate limiting, auth

---

## Autor

**Veriel.dev** - Software Developer

---

<div align="center">

**Sistema de colas construido con Node.js + TypeScript + Redis**

[![GitHub](https://img.shields.io/badge/GitHub-Repositorio-181717?style=flat-square&logo=github)](https://github.com/veriel-dev/task-scheduler-service)

</div>
