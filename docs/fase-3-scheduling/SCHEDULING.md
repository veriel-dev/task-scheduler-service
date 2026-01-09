# Fase 3: Sistema de Scheduling

## Descripcion General

El sistema de Scheduling permite crear tareas programadas que se ejecutan automaticamente basandose en expresiones cron. Cuando un schedule alcanza su `nextRunAt`, el ScheduleExecutor crea automaticamente un Job y lo encola para procesamiento.

## Arquitectura

```
                    +----------------------+
                    |   Schedule (Prisma)   |
                    |   - cronExpr          |
                    |   - timezone          |
                    |   - nextRunAt         |
                    |   - jobType           |
                    |   - jobPayload        |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    |  ScheduleExecutor    |
                    |  (proceso separado)   |
                    |  - checkIntervalMs   |
                    +----------+-----------+
                               |
          cada 10s verifica    |
          nextRunAt <= now     |
                               v
                    +----------------------+
                    |      CronParser      |
                    |  (wrapper de croner) |
                    |  - getNextRun()      |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    |   JobService.create  |
                    |   (crea y encola)    |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    |   QueueManager       |
                    |   (Redis)            |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    |      Worker          |
                    |  (procesa el job)    |
                    +----------------------+
```

## Componentes

### 1. CronParser (`src/core/scheduler/CronParser.ts`)

Wrapper sobre la libreria `croner` que proporciona una API simplificada para trabajar con expresiones cron.

#### Por que croner?

- **Soporte nativo de timezones**: Usa `Intl.DateTimeFormat` para manejar zonas horarias correctamente
- **API moderna**: Diseñada para TypeScript con tipos incluidos
- **Ligera y rapida**: Sin dependencias innecesarias
- **Expresiones cron estandar**: Soporta formato de 5 campos (min hour dom mon dow)

#### Metodos

```typescript
class CronParser {
  // Valida si una expresion cron es correcta
  static isValid(cronExpr: string): boolean

  // Calcula la proxima ejecucion
  static getNextRun(cronExpr: string, timezone?: string, fromDate?: Date): Date | null

  // Calcula las proximas N ejecuciones
  static getNextRuns(cronExpr: string, timezone?: string, count?: number, fromDate?: Date): Date[]

  // Valida un timezone IANA
  static isValidTimezone(timezone: string): boolean

  // Describe una expresion cron en lenguaje humano
  static describe(cronExpr: string): string
}
```

#### Ejemplos de expresiones cron

| Expresion | Descripcion |
|-----------|-------------|
| `* * * * *` | Cada minuto |
| `0 * * * *` | Cada hora (minuto 0) |
| `0 9 * * *` | Todos los dias a las 9:00 |
| `0 9 * * 1-5` | Lunes a viernes a las 9:00 |
| `*/15 * * * *` | Cada 15 minutos |
| `0 0 1 * *` | Primer dia de cada mes a medianoche |

### 2. ScheduleExecutor (`src/core/scheduler/ScheduleExecutor.ts`)

Proceso independiente que verifica schedules pendientes y crea jobs automaticamente.

#### Configuracion

```typescript
interface ScheduleExecutorConfig {
  checkIntervalMs: number;  // Intervalo de verificacion (default: 10000ms)
  batchSize: number;        // Schedules por ciclo (default: 100)
}
```

#### Flujo de ejecucion

```
1. start()
   |
   v
2. checkAndExecute() -- ejecuta inmediatamente
   |
   v
3. setInterval(checkAndExecute, checkIntervalMs)
   |
   v
4. En cada ciclo:
   a. findDueSchedules(now) -- busca schedules donde nextRunAt <= now AND enabled
   b. Para cada schedule:
      - Crear job con jobType, jobPayload, jobPriority
      - Vincular job al schedule (scheduleId)
      - Encolar job en Redis
      - Calcular nuevo nextRunAt usando CronParser
      - Actualizar lastRunAt, nextRunAt, runCount
```

#### Manejo de errores

Si falla la creacion del job, el executor:
1. Loguea el error
2. Intenta actualizar `nextRunAt` de todas formas
3. Continua con el siguiente schedule

Esto evita que un schedule se quede "atascado" por un error temporal.

### 3. ScheduleRepository (`src/repositories/schedule.repository.ts`)

Capa de acceso a datos para schedules.

#### Metodos clave

```typescript
// Encuentra schedules listos para ejecutar
async findDueSchedules(now: Date): Promise<Schedule[]>
// Query: enabled = true AND nextRunAt <= now

// Actualiza despues de ejecutar
async markExecuted(id: string, nextRunAt: Date | null): Promise<Schedule>
// Incrementa runCount, actualiza lastRunAt y nextRunAt

// Habilita/deshabilita
async setEnabled(id: string, enabled: boolean, nextRunAt?: Date | null): Promise<Schedule>
```

### 4. ScheduleService (`src/services/schedule.service.ts`)

Logica de negocio para schedules.

#### Responsabilidades

- **Crear schedule**: Valida input, calcula `nextRunAt` inicial
- **Actualizar schedule**: Recalcula `nextRunAt` si cambia cron/timezone/enabled
- **Enable/Disable**: Maneja el estado y recalcula nextRunAt
- **Trigger manual**: Crea job inmediatamente sin esperar al cron
- **getNextRuns**: Muestra proximas ejecuciones para preview

#### Ejemplo: Trigger manual

```typescript
async trigger(id: string): Promise<Job> {
  const schedule = await this.scheduleRepository.findById(id);

  // Crear job basado en el template del schedule
  const job = await this.jobRepository.create({
    name: `${schedule.name} (manual trigger)`,
    type: schedule.jobType,
    payload: schedule.jobPayload,
    priority: schedule.jobPriority,
    maxRetries: 3,
    retryDelay: 1000,
  });

  // Vincular y encolar
  await this.jobRepository.update(job.id, { scheduleId: schedule.id });
  await this.queueManager.enqueue(job.id, job.priority);

  return this.jobRepository.updateStatus(job.id, 'QUEUED');
}
```

## API Endpoints

### CRUD Basico

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| `POST` | `/api/v1/schedules` | Crear schedule |
| `GET` | `/api/v1/schedules` | Listar schedules (paginado) |
| `GET` | `/api/v1/schedules/:id` | Obtener schedule con jobs recientes |
| `PATCH` | `/api/v1/schedules/:id` | Actualizar schedule |
| `DELETE` | `/api/v1/schedules/:id` | Eliminar schedule |

### Acciones Especiales

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| `POST` | `/api/v1/schedules/:id/enable` | Habilitar schedule |
| `POST` | `/api/v1/schedules/:id/disable` | Deshabilitar schedule |
| `POST` | `/api/v1/schedules/:id/trigger` | Ejecutar manualmente |
| `GET` | `/api/v1/schedules/:id/next-runs` | Ver proximas 10 ejecuciones |

### Ejemplo: Crear schedule

```bash
curl -X POST http://localhost:3000/api/v1/schedules \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Daily Report",
    "description": "Generate daily sales report",
    "cronExpr": "0 9 * * *",
    "timezone": "America/New_York",
    "jobType": "report.generate",
    "jobPayload": { "reportType": "sales", "format": "pdf" },
    "jobPriority": "NORMAL"
  }'
```

### Ejemplo: Respuesta

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Daily Report",
  "description": "Generate daily sales report",
  "cronExpr": "0 9 * * *",
  "timezone": "America/New_York",
  "jobType": "report.generate",
  "jobPayload": { "reportType": "sales", "format": "pdf" },
  "jobPriority": "NORMAL",
  "enabled": true,
  "lastRunAt": null,
  "nextRunAt": "2025-01-07T14:00:00.000Z",
  "runCount": 0,
  "createdAt": "2025-01-06T22:00:00.000Z",
  "updatedAt": "2025-01-06T22:00:00.000Z"
}
```

## Modelo de Datos

### Schedule (Prisma)

```prisma
model Schedule {
  id          String      @id @default(uuid())
  name        String
  description String?

  // Configuracion cron
  cronExpr    String      // "0 9 * * *"
  timezone    String      @default("UTC")

  // Template del job
  jobType     String
  jobPayload  Json
  jobPriority JobPriority @default(NORMAL)

  // Estado
  enabled     Boolean     @default(true)
  lastRunAt   DateTime?
  nextRunAt   DateTime?
  runCount    Int         @default(0)

  // Relacion con jobs generados
  jobs        Job[]

  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  @@index([enabled])
  @@index([nextRunAt])  // Critico para findDueSchedules
}
```

### Relacion Schedule -> Jobs

Cuando el ScheduleExecutor crea un job, lo vincula al schedule mediante `scheduleId`. Esto permite:

- Ver historial de ejecuciones de un schedule
- Rastrear que jobs fueron generados automaticamente vs manualmente
- Mantener jobs huerfanos si se elimina el schedule (`onDelete: SetNull`)

## Ejecucion

El sistema tiene 3 procesos independientes:

```bash
# Terminal 1: API Server
pnpm dev

# Terminal 2: Worker (procesa jobs)
pnpm worker

# Terminal 3: Scheduler (crea jobs desde schedules)
pnpm scheduler
```

### Variables de entorno

```env
# Intervalo de verificacion de schedules (default: 10000ms)
SCHEDULER_CHECK_INTERVAL_MS=10000

# Timezone por defecto para nuevos schedules (default: UTC)
SCHEDULER_DEFAULT_TIMEZONE=UTC
```

## Validaciones

### Expresion Cron

- Validada con `CronParser.isValid()` antes de guardar
- Soporta formato de 5 campos: minuto, hora, dia del mes, mes, dia de la semana
- Ejemplos validos: `* * * * *`, `0 9 * * 1-5`, `*/15 * * * *`

### Timezone

- Validada con `Intl.DateTimeFormat` (standard ECMAScript)
- Debe ser formato IANA: `America/New_York`, `Europe/Madrid`, `UTC`
- Rechaza formatos obsoletos como `EST`, `GMT+5`

### Estados y Transiciones

```
                    +----------+
                    |  enabled |
                    +----+-----+
                         |
        +----------------+----------------+
        |                                 |
        v                                 v
+---------------+                 +---------------+
|  nextRunAt    |  (recalcula)    |  nextRunAt    |
|  = Date       | <-------------> |  = null       |
+---------------+   enable()      +---------------+
                    disable()
```

## Tests

### CronParser Tests (16 tests)

```
- isValid: expresiones validas e invalidas
- getNextRun: calculo basico, timezones, fecha base
- getNextRuns: multiples ejecuciones, count
- isValidTimezone: IANA validos e invalidos
- describe: descripcion de expresiones comunes
```

### ScheduleService Tests (20 tests)

```
- create: con nextRunAt calculado, disabled con null
- getById: encontrado y NotFoundError
- enable/disable: estado y nextRunAt
- trigger: crea job, encola, vincula
- getNextRuns: enabled vs disabled
- update: recalcula nextRunAt cuando cambia cron/timezone
- delete: eliminacion y NotFoundError
```

## Consideraciones de Diseno

### Por que proceso separado?

El ScheduleExecutor corre como proceso independiente (`pnpm scheduler`) por varias razones:

1. **Separacion de responsabilidades**: El API server maneja requests HTTP, el scheduler maneja tiempo
2. **Escalabilidad**: Se puede escalar API y workers independientemente del scheduler
3. **Resiliencia**: Si el scheduler falla, la API sigue funcionando

### Por que checkInterval de 10 segundos?

- Balance entre precision y carga en la base de datos
- Para la mayoria de casos de uso (cron por minuto), 10s es suficiente
- Configurable via `SCHEDULER_CHECK_INTERVAL_MS` para casos especiales

### Manejo de timezones

El sistema usa `croner` que internamente usa `Intl.DateTimeFormat` para:

1. Parsear la expresion cron en la zona horaria especificada
2. Calcular `nextRunAt` en UTC (para almacenar en PostgreSQL)
3. Manejar cambios de horario (DST) correctamente

### Edge cases manejados

| Caso | Solucion |
|------|----------|
| Schedule deshabilitado | `nextRunAt = null`, no aparece en `findDueSchedules` |
| Error al crear job | Se actualiza `nextRunAt` para evitar atascamiento |
| Expresion cron invalida | Validacion Zod rechaza en la API |
| Timezone invalido | Validacion con `Intl.DateTimeFormat` |
| Multiples instancias scheduler | **RIESGO**: Ver recomendaciones futuras |

## Recomendaciones Futuras

### Locking distribuido

Para evitar que multiples instancias del scheduler ejecuten el mismo schedule:

```typescript
// Usar Redis SETNX para lock
const lockKey = `scheduler:lock:${schedule.id}`;
const acquired = await redis.set(lockKey, workerId, 'NX', 'EX', 60);

if (!acquired) {
  // Otra instancia tiene el lock
  return;
}

try {
  await executeSchedule(schedule);
} finally {
  await redis.del(lockKey);
}
```

### Metricas

Agregar contadores para monitoreo:
- Schedules ejecutados por minuto
- Tiempo de ejecucion del check
- Errores por schedule
- Jobs creados por schedule

### Alertas

Notificar si un schedule no se ejecuta en X tiempo desde su `nextRunAt`.
