# Priority Queue

## Concepto

La Priority Queue ordena jobs por prioridad usando Redis Sorted Sets (ZSET).

## Cálculo del Score

```typescript
Score = timestamp - PRIORITY_OFFSET

PRIORITY_SCORES = {
  CRITICAL: 0,         // Sin offset
  HIGH:     1_000_000, // -1M
  NORMAL:   2_000_000, // -2M
  LOW:      3_000_000, // -3M
}
```

## Ejemplo Visual

Tres jobs llegan en el mismo segundo (T = 1704067200000):

```
Job A: priority = CRITICAL
  score = 1704067200000 - 0 = 1704067200000

Job B: priority = HIGH
  score = 1704067200000 - 1000000 = 1704066200000

Job C: priority = LOW
  score = 1704067200000 - 3000000 = 1704064200000

Redis ZSET (ordenado por score ASC):
┌────────────────────┬────────┐
│ score              │ member │
├────────────────────┼────────┤
│ 1704064200000      │ Job C  │  ← menor score
│ 1704066200000      │ Job B  │
│ 1704067200000      │ Job A  │  ← mayor score
└────────────────────┴────────┘

ZPOPMIN retorna Job C primero... ¿ERROR?
```

**Espera, eso está al revés.** Vamos a recalcular:

```typescript
// Corrección: restamos de un valor grande, no del timestamp
Score = timestamp + PRIORITY_OFFSET (no resta)

// O mejor: score = timestamp - (MAX_PRIORITY - priority_offset)
// Donde CRITICAL tiene el offset más alto
```

**Implementación real:**
```typescript
// Lo que hace el código actual:
score = timestamp - PRIORITY_SCORES[priority]

// CRITICAL: timestamp - 0         = timestamp (mayor)
// LOW:      timestamp - 3_000_000 = timestamp - 3M (menor)
```

El score MÁS BAJO se procesa primero (ZPOPMIN). Por lo tanto:
- LOW tiene score más bajo → se procesaría primero ❌

**La lógica correcta debería ser:**
```typescript
score = timestamp + PRIORITY_SCORES[priority]
// O usar scores negativos para priority
```

**Nota:** En la implementación actual, el offset se resta, lo que significa que jobs LOW tienen menor score y se procesan primero. Esto puede ser un bug a corregir o una decisión de diseño documentada.

## Garantías

| Garantía | Descripción |
|----------|-------------|
| FIFO dentro de prioridad | Dos jobs NORMAL consecutivos se procesan en orden |
| Atomicidad | ZADD y ZPOPMIN son operaciones atómicas |
| Sin duplicados | El mismo jobId solo puede estar una vez |

## Operaciones Redis

```bash
# Encolar job
ZADD scheduler:queue:priority 1704067200000 "job-123"

# Ver cola
ZRANGE scheduler:queue:priority 0 -1 WITHSCORES

# Obtener siguiente (atómico)
ZPOPMIN scheduler:queue:priority

# Contar jobs
ZCARD scheduler:queue:priority
```

## Uso desde QueueManager

```typescript
// Encolar
await queueManager.enqueue(jobId, 'HIGH');

// Obtener siguiente
const jobId = await queueManager.dequeue();
```
