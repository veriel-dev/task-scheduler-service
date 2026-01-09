# Task Scheduler Service - Conceptos de Arquitectura

Este documento explica los conceptos fundamentales del sistema de programación de tareas y colas de trabajo.

---

## Tabla de Contenidos

1. [Visión General](#visión-general)
2. [Conceptos Principales](#conceptos-principales)
   - [Job](#job)
   - [Schedule](#schedule)
   - [Worker](#worker)
   - [Dead Letter Queue](#dead-letter-queue)
3. [Diferencia entre Job y Schedule](#diferencia-entre-job-y-schedule)
4. [Flujo de Ejecución](#flujo-de-ejecución)
5. [Arquitectura de Procesos](#arquitectura-de-procesos)
6. [Workers y Concurrencia](#workers-y-concurrencia)
7. [Estados de un Job](#estados-de-un-job)
8. [Prioridades](#prioridades)
9. [Apéndice A: Tipos de Procesos (Servidor HTTP vs Daemon)](#apéndice-a-tipos-de-procesos-servidor-http-vs-daemon)

---

## Visión General

El Task Scheduler Service es un sistema que permite:

- Ejecutar tareas en segundo plano (background jobs)
- Programar tareas automáticas con expresiones cron
- Escalar horizontalmente con múltiples workers
- Reintentar tareas fallidas con backoff exponencial
- Mantener un registro de fallos para análisis

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ARQUITECTURA GENERAL                         │
│                                                                      │
│  ┌─────────┐     ┌─────────────┐     ┌─────────────────────────┐   │
│  │   API   │────▶│    Redis    │◀────│        Workers          │   │
│  │         │     │   (Cola)    │     │  (N procesos Node.js)   │   │
│  └─────────┘     └─────────────┘     └─────────────────────────┘   │
│       │                                          │                  │
│       │          ┌─────────────┐                 │                  │
│       └─────────▶│ PostgreSQL  │◀────────────────┘                  │
│                  │   (Estado)  │                                    │
│                  └─────────────┘                                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Conceptos Principales

### Job

Un **Job** es una **tarea concreta** que debe ejecutarse. Representa una unidad de trabajo.

**Características:**
- Tiene un tipo (ej: `email.send`, `report.generate`, `cleanup.logs`)
- Contiene un payload con los datos necesarios para ejecutarse
- Tiene un estado que cambia durante su ciclo de vida
- Puede tener prioridad (CRITICAL, HIGH, NORMAL, LOW)
- Puede programarse para ejecutarse en el futuro (`scheduledAt`)
- Puede reintentar automáticamente si falla

**Ejemplos de Jobs:**
| Tipo | Payload | Descripción |
|------|---------|-------------|
| `email.send` | `{to: "juan@mail.com", subject: "Hola"}` | Enviar un email |
| `report.generate` | `{type: "weekly", format: "pdf"}` | Generar un reporte |
| `image.resize` | `{imageId: "123", width: 800}` | Redimensionar imagen |
| `cleanup.logs` | `{olderThan: "30d"}` | Limpiar logs antiguos |

**Creación de Jobs:**
```
1. Manual (via API):     POST /api/jobs → Job se encola
2. Automático (Schedule): El Scheduler crea Jobs según el cron
```

---

### Schedule

Un **Schedule** es una **regla de programación** que genera Jobs automáticamente según un horario definido con expresiones cron.

**Características:**
- Define CUÁNDO crear Jobs (expresión cron)
- Define QUÉ Job crear (tipo, payload, prioridad)
- Puede habilitarse/deshabilitarse
- Rastrea última y próxima ejecución

**Expresiones Cron:**
```
┌───────────── minuto (0-59)
│ ┌───────────── hora (0-23)
│ │ ┌───────────── día del mes (1-31)
│ │ │ ┌───────────── mes (1-12)
│ │ │ │ ┌───────────── día de la semana (0-6, 0=domingo)
│ │ │ │ │
* * * * *
```

**Ejemplos de Schedules:**
| Nombre | Cron | Descripción |
|--------|------|-------------|
| Backup diario | `0 3 * * *` | Cada día a las 3:00 AM |
| Reporte semanal | `0 9 * * 1` | Cada lunes a las 9:00 AM |
| Limpieza cada hora | `0 * * * *` | Cada hora en punto |
| Cada 5 minutos | `*/5 * * * *` | Cada 5 minutos |

**Relación Schedule → Jobs:**
```
Schedule: "Backup diario" (cron: 0 3 * * *)
    │
    ├── Job: backup_2025-12-28_03:00 ✓ COMPLETED
    ├── Job: backup_2025-12-29_03:00 ✓ COMPLETED
    ├── Job: backup_2025-12-30_03:00 ✓ COMPLETED
    └── Job: backup_2025-12-31_03:00 ⏳ PENDING (próximo)
```

---

### Worker

Un **Worker** es un **proceso Node.js independiente** que toma Jobs de la cola y los ejecuta.

**Características:**
- Es un proceso separado (no un hilo)
- Espera Jobs en la cola de Redis
- Ejecuta el código asociado al tipo de Job
- Reporta el resultado (éxito o fallo)
- Puede manejar múltiples Jobs en paralelo (concurrencia configurable)

**¿Por qué procesos separados?**

Node.js es single-threaded. Si ejecutamos todo en un proceso:
- Un Job pesado bloquearía la API
- No podríamos procesar Jobs en paralelo
- Si el proceso muere, todo muere

Con Workers separados:
- La API siempre responde
- Procesamos N Jobs en paralelo (N workers)
- Si un Worker muere, los otros siguen

**Escalabilidad:**
```bash
# Desarrollo
pnpm worker              # 1 worker

# Producción
pnpm worker &            # Worker 1
pnpm worker &            # Worker 2
pnpm worker &            # Worker 3
# ... cuantos necesites
```

**Recomendaciones de cantidad:**
| Escenario | Workers |
|-----------|---------|
| Desarrollo local | 1-2 |
| Producción pequeña | 2-4 |
| Alta carga | 10+ |
| Jobs CPU-intensivos | 1 por CPU core |
| Jobs I/O (HTTP, DB) | Más workers por máquina |

---

### Dead Letter Queue

La **Dead Letter Queue (DLQ)** es una tabla que almacena Jobs que fallaron definitivamente después de agotar todos sus reintentos.

**Propósito:**
- Mantener registro de fallos para análisis
- No perder información de Jobs problemáticos
- Permitir re-procesamiento manual si es necesario
- Identificar patrones de errores

**Flujo hacia DLQ:**
```
Job falla
    │
    ▼
¿Quedan reintentos? ──Sí──▶ RETRYING (espera backoff, reintenta)
    │
    No
    │
    ▼
Mover a Dead Letter Queue
(Job status = FAILED)
```

**Información guardada en DLQ:**
- Datos originales del Job (tipo, payload, prioridad)
- Razón del fallo
- Número de intentos realizados
- Último mensaje de error
- Stack trace (si está disponible)
- Timestamp de cuándo falló

---

## Diferencia entre Job y Schedule

| Aspecto | Job | Schedule |
|---------|-----|----------|
| **¿Qué es?** | Una tarea concreta | Una regla de programación |
| **¿Quién lo crea?** | Usuario (API) o Schedule | Usuario (API) |
| **¿Cuántos se crean?** | Uno por tarea | Uno, genera muchos Jobs |
| **¿Se ejecuta?** | Sí, por un Worker | No, solo crea Jobs |
| **Analogía** | "Enviar email a Juan ahora" | "Enviar resumen cada lunes" |

**Ejemplo visual:**
```
┌─────────────────────────────────────────────────────────────┐
│                      SCHEDULES                               │
│  (reglas que crean Jobs automáticamente)                    │
│                                                              │
│  ┌─────────────────────┐    ┌─────────────────────┐        │
│  │ "Backup diario"     │    │ "Reporte semanal"   │        │
│  │ cron: 0 3 * * *     │    │ cron: 0 9 * * 1     │        │
│  └──────────┬──────────┘    └──────────┬──────────┘        │
│             │                          │                    │
│             ▼                          ▼                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                       JOBS                           │   │
│  │  (tareas concretas que se ejecutan)                 │   │
│  │                                                      │   │
│  │  backup_día1 ✓   backup_día2 ✓   reporte_sem1 ✓    │   │
│  │  backup_día3 ⏳   email_manual ✓  procesar_img ✓   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Flujo de Ejecución

### Flujo completo de un Job

```
1. CREACIÓN
   ┌─────────────────────────────────────┐
   │ Usuario llama POST /api/jobs        │
   │ o Schedule detecta que toca ejecutar│
   └─────────────────┬───────────────────┘
                     │
                     ▼
2. ENCOLADO
   ┌─────────────────────────────────────┐
   │ Job se guarda en PostgreSQL         │
   │ Job se añade a cola en Redis        │
   │ status: PENDING → QUEUED            │
   └─────────────────┬───────────────────┘
                     │
                     ▼
3. PROCESAMIENTO
   ┌─────────────────────────────────────┐
   │ Worker toma Job de la cola          │
   │ status: QUEUED → PROCESSING         │
   │ Worker ejecuta el código del Job    │
   └─────────────────┬───────────────────┘
                     │
          ┌─────────┴─────────┐
          ▼                   ▼
4A. ÉXITO                 4B. FALLO
┌─────────────────┐    ┌─────────────────┐
│ status:         │    │ ¿Quedan         │
│ COMPLETED       │    │ reintentos?     │
│                 │    └────────┬────────┘
│ Si hay webhook, │          Sí │ No
│ notificar       │             ▼   ▼
└─────────────────┘    ┌───────────┐ ┌───────────┐
                       │ RETRYING  │ │ FAILED    │
                       │ (backoff) │ │ → DLQ     │
                       └───────────┘ └───────────┘
```

### Diagrama de secuencia

```
Usuario        API         PostgreSQL      Redis         Worker
   │            │              │             │              │
   │──POST /job─▶              │             │              │
   │            │──INSERT──────▶             │              │
   │            │              │             │              │
   │            │──────────────────ZADD─────▶│              │
   │            │              │             │              │
   │◀──202 OK───│              │             │              │
   │            │              │             │              │
   │            │              │             │◀───BRPOP─────│
   │            │              │             │              │
   │            │              │             │───job data──▶│
   │            │              │             │              │
   │            │              │             │              │──ejecuta
   │            │              │             │              │
   │            │              │◀────────UPDATE status──────│
   │            │              │             │              │
```

---

## Arquitectura de Procesos

El sistema tiene 3 tipos de procesos:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         PROCESOS DEL SISTEMA                         │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ API (1 instancia)                                            │   │
│  │ Comando: pnpm dev                                            │   │
│  │ Responsabilidad: Recibir peticiones HTTP, crear Jobs/Schedules│  │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Scheduler (1 instancia)                                      │   │
│  │ Comando: pnpm scheduler                                      │   │
│  │ Responsabilidad: Revisar Schedules, crear Jobs según cron    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Workers (N instancias)                                       │   │
│  │ Comando: pnpm worker                                         │   │
│  │ Responsabilidad: Tomar Jobs de la cola y ejecutarlos         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**¿Por qué separados?**

| Proceso | Escalabilidad | Notas |
|---------|---------------|-------|
| API | Horizontal (load balancer) | Puede haber múltiples |
| Scheduler | Solo 1 | Evita Jobs duplicados |
| Workers | Horizontal (cuantos quieras) | Escala según carga |

---

## Workers y Concurrencia

### ¿Por qué múltiples Workers?

Node.js es single-threaded. Un solo proceso no puede aprovechar múltiples CPU cores ni ejecutar código JavaScript en paralelo.

**Solución:** Lanzar múltiples procesos Node.js (Workers).

```
┌─────────────────────────────────────────────────────────────┐
│                     MÁQUINA (4 CPU cores)                    │
│                                                              │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐   │
│  │ Worker 1  │ │ Worker 2  │ │ Worker 3  │ │ Worker 4  │   │
│  │ PID: 1001 │ │ PID: 1002 │ │ PID: 1003 │ │ PID: 1004 │   │
│  │           │ │           │ │           │ │           │   │
│  │ Job A     │ │ Job B     │ │ Job C     │ │ Job D     │   │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘   │
│       │             │             │             │           │
│       └─────────────┴─────────────┴─────────────┘           │
│                           │                                  │
│                           ▼                                  │
│                    ┌─────────────┐                          │
│                    │    Redis    │                          │
│                    │   (Cola)    │                          │
│                    └─────────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

### Concurrencia por Worker

Cada Worker puede procesar múltiples Jobs a la vez (si son I/O-bound):

```
┌─────────────────────────────────────┐
│ Worker 1 (concurrency: 3)           │
│                                     │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐│
│  │ Job A   │ │ Job B   │ │ Job C   ││
│  │ (HTTP)  │ │ (DB)    │ │ (HTTP)  ││
│  │ waiting │ │ waiting │ │ waiting ││
│  └─────────┘ └─────────┘ └─────────┘│
│                                     │
│  Todos esperan I/O, no se bloquean  │
└─────────────────────────────────────┘
```

---

## Estados de un Job

```
┌─────────────────────────────────────────────────────────────┐
│                    ESTADOS DE UN JOB                         │
│                                                              │
│  PENDING ──▶ QUEUED ──▶ PROCESSING ──┬──▶ COMPLETED         │
│     │                                 │                      │
│     │                                 ├──▶ RETRYING ─┐       │
│     │                                 │              │       │
│     ▼                                 │              ▼       │
│  CANCELLED                            └──▶ FAILED ◀──┘       │
│                                              │               │
│                                              ▼               │
│                                         Dead Letter         │
│                                           Queue             │
└─────────────────────────────────────────────────────────────┘
```

| Estado | Descripción |
|--------|-------------|
| **PENDING** | Job creado, esperando ser encolado |
| **QUEUED** | En cola de Redis, esperando Worker |
| **PROCESSING** | Un Worker lo está ejecutando |
| **COMPLETED** | Ejecutado exitosamente |
| **FAILED** | Falló después de todos los reintentos |
| **RETRYING** | Falló, esperando para reintentar |
| **CANCELLED** | Cancelado manualmente |

---

## Prioridades

Los Jobs tienen prioridad que afecta el orden de procesamiento:

```
┌─────────────────────────────────────────────────────────────┐
│                    COLA DE PRIORIDAD                         │
│                                                              │
│  Orden de procesamiento:                                     │
│                                                              │
│  1. CRITICAL  ████████████████████  (primero)               │
│  2. HIGH      ████████████████                               │
│  3. NORMAL    ████████████                                   │
│  4. LOW       ████████                    (último)           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Implementación en Redis:**

Se usa un Sorted Set (ZADD) donde el score combina timestamp y prioridad:

```
score = timestamp - (prioridad * 1000000)
```

Esto asegura que:
1. Jobs con mayor prioridad tienen menor score (se procesan primero)
2. Dentro de la misma prioridad, se procesa por orden de llegada (FIFO)

---

## Resumen

| Concepto | Definición | Responsabilidad |
|----------|------------|-----------------|
| **Job** | Tarea concreta | Contiene qué hacer y datos necesarios |
| **Schedule** | Regla cron | Crea Jobs automáticamente |
| **Worker** | Proceso Node.js | Ejecuta Jobs |
| **DLQ** | Tabla de fallos | Almacena Jobs fallidos para análisis |
| **API** | Servidor HTTP | Recibe peticiones, crea Jobs/Schedules |
| **Scheduler** | Proceso daemon | Revisa Schedules y crea Jobs |

```
Usuario ──▶ API ──▶ Job ──▶ Redis ──▶ Worker ──▶ Resultado
                      ▲
           Schedule ──┘ (automático)
```

---

## Apéndice A: Tipos de Procesos (Servidor HTTP vs Daemon)

### ¿Qué es un Servidor HTTP?

Un servidor HTTP es un proceso que **escucha en un puerto** y responde a peticiones HTTP.

```javascript
// API (servidor HTTP)
import express from 'express'

const app = express()

app.post('/jobs', (req, res) => {
  // Crear job...
  res.json({ id: job.id })
})

app.listen(3000) // ← Escucha en puerto 3000
```

**Características:**
- Expone un puerto (ej: 3000)
- Responde a peticiones HTTP (GET, POST, etc.)
- Clientes externos pueden conectarse

---

### ¿Qué es un Daemon?

Un **daemon** es un proceso que corre en segundo plano ejecutando un bucle infinito. No expone ningún puerto.

```javascript
// Scheduler (daemon)
async function startScheduler() {
  console.log('Scheduler iniciado...')

  while (true) {
    const schedules = await getActiveSchedules()

    for (const schedule of schedules) {
      if (shouldRunNow(schedule)) {
        await createJobFromSchedule(schedule)
      }
    }

    await sleep(10000) // Espera 10 segundos entre iteraciones
  }
}
```

```javascript
// Worker (daemon)
async function startWorker() {
  console.log('Worker iniciado...')

  while (true) {
    // BRPOP = espera bloqueante hasta que llegue un job
    const job = await redis.brPop('queue', 0)

    await processJob(job)
  }
}
```

**Características:**
- No expone puerto
- Corre indefinidamente (hasta que lo matas)
- Ejecuta tareas en bucle
- No recibe peticiones externas

---

### Comparación

| Aspecto | API (Servidor HTTP) | Scheduler/Worker (Daemon) |
|---------|---------------------|---------------------------|
| **Puerto** | Sí (ej: 3000) | No |
| **Recibe peticiones** | Sí (HTTP) | No |
| **Comportamiento** | Espera conexiones | Bucle infinito |
| **Código típico** | `app.listen(port)` | `while (true) { ... }` |
| **Cómo se comunica** | HTTP requests | Redis, PostgreSQL |

---

### Diagrama de puertos

```
                    Puerto 3000
                         │
Usuario ────HTTP────────▶│
                         ▼
                    ┌─────────┐
                    │   API   │  ← Único proceso con puerto expuesto
                    └────┬────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   ┌─────────┐     ┌──────────┐     ┌──────────┐
   │  Redis  │     │ Postgres │     │Scheduler │ ← Sin puerto (daemon)
   │  :6379  │     │  :5432   │     │          │
   └─────────┘     └──────────┘     └──────────┘
        ▲
        │
   ┌────┴────┐
   │ Worker  │  ← Sin puerto (daemon)
   └─────────┘
```

---

### Origen del término "Daemon"

El término viene de Unix/Linux. Un **daemon** es un proceso que:

- Corre en segundo plano (background)
- No tiene interfaz de usuario
- Corre indefinidamente hasta que se detiene explícitamente
- Realiza una tarea repetitiva o espera eventos

**Ejemplos de daemons conocidos:**

| Daemon | Función |
|--------|---------|
| `nginx` | Servidor web |
| `cron` | Ejecutor de tareas programadas |
| `redis-server` | Base de datos Redis |
| `postgresql` | Base de datos PostgreSQL |
| `sshd` | Servidor SSH |

Nuestros **Scheduler** y **Worker** son daemons escritos en Node.js.
