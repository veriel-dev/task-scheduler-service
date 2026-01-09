# Comandos Redis

Guía de referencia de los comandos Redis utilizados en el Task Scheduler Service.

## Estructuras de Datos

### 1. Sorted Set (ZSET)

Un Sorted Set es un conjunto donde cada elemento tiene un **score** (número) que determina su orden. Redis mantiene los elementos ordenados automáticamente por score.

```
ZSET "scheduler:queue:priority"
┌─────────────────┬─────────┐
│ score           │ member  │
├─────────────────┼─────────┤
│ 1704067200000   │ job-abc │  ← menor score = primero
│ 1704067201000   │ job-def │
│ 1704070200000   │ job-ghi │  ← mayor score = último
└─────────────────┴─────────┘
```

**Características:**
- Elementos únicos (no hay duplicados)
- Ordenados por score (ascendente)
- Operaciones O(log N)

### 2. Hash (HSET)

Un Hash es un mapa clave-valor dentro de una clave Redis. Similar a un objeto/diccionario.

```
HASH "scheduler:processing"
┌─────────┬──────────────────────────────────────┐
│ field   │ value                                │
├─────────┼──────────────────────────────────────┤
│ job-abc │ {"workerId":"w1","startedAt":170406} │
│ job-def │ {"workerId":"w2","startedAt":170407} │
└─────────┴──────────────────────────────────────┘
```

**Características:**
- Acceso O(1) por campo
- Ideal para objetos con múltiples atributos
- Eficiente en memoria

---

## Comandos ZSET (Sorted Set)

### ZADD

**Significado:** Z (sorted set) ADD

**Sintaxis:** `ZADD key score member [score member ...]`

**Descripción:** Agrega uno o más elementos al sorted set con su score correspondiente. Si el elemento ya existe, actualiza su score.

```bash
# Ejemplo CLI
ZADD scheduler:queue:priority 1704067200000 "job-abc"
ZADD scheduler:queue:priority 1704067201000 "job-def" 1704067202000 "job-ghi"
```

```typescript
// Uso en QueueManager
await client.zAdd(QUEUE_KEYS.PRIORITY, {
  score: timestamp + PRIORITY_SCORES[priority],
  value: jobId
});
```

**Uso en el proyecto:** Encolar jobs en la priority queue y delayed queue.

---

### ZPOPMIN

**Significado:** Z POP MIN(imum)

**Sintaxis:** `ZPOPMIN key [count]`

**Descripción:** Extrae y retorna el elemento con el menor score. Operación atómica (lee y elimina en un solo paso).

```bash
# Ejemplo CLI
ZPOPMIN scheduler:queue:priority
# Retorna: "job-abc" con su score
```

```typescript
// Uso en QueueManager
const result = await client.zPopMin(QUEUE_KEYS.PRIORITY);
// result = { value: "job-abc", score: 1704067200000 }
```

**Uso en el proyecto:** Obtener el siguiente job a procesar (el de mayor prioridad).

---

### ZRANGEBYSCORE

**Significado:** Z RANGE BY SCORE

**Sintaxis:** `ZRANGEBYSCORE key min max [WITHSCORES] [LIMIT offset count]`

**Descripción:** Retorna todos los elementos con score entre min y max (inclusive).

```bash
# Ejemplo CLI - obtener jobs con score entre 0 y ahora
ZRANGEBYSCORE scheduler:queue:delayed 0 1704067200000

# Con scores incluidos
ZRANGEBYSCORE scheduler:queue:delayed 0 1704067200000 WITHSCORES
```

```typescript
// Uso en QueueManager
const now = Date.now();
const readyJobs = await client.zRangeByScore(QUEUE_KEYS.DELAYED, 0, now);
// readyJobs = ["job-abc:HIGH", "job-def:NORMAL"]
```

**Uso en el proyecto:** Buscar jobs diferidos que ya están listos para ejecutarse (su timestamp <= ahora).

---

### ZREM

**Significado:** Z REM(ove)

**Sintaxis:** `ZREM key member [member ...]`

**Descripción:** Elimina uno o más elementos específicos del sorted set.

```bash
# Ejemplo CLI
ZREM scheduler:queue:delayed "job-abc:HIGH"
```

```typescript
// Uso en QueueManager
await client.zRem(QUEUE_KEYS.DELAYED, entry);
```

**Uso en el proyecto:** Remover job de la delayed queue después de promoverlo a la priority queue.

---

### ZCARD

**Significado:** Z CARD(inality)

**Sintaxis:** `ZCARD key`

**Descripción:** Retorna el número de elementos en el sorted set.

```bash
# Ejemplo CLI
ZCARD scheduler:queue:priority
# Retorna: 42
```

```typescript
// Uso en QueueManager
const count = await client.zCard(QUEUE_KEYS.PRIORITY);
```

**Uso en el proyecto:** Obtener estadísticas de cuántos jobs hay en cada cola.

---

## Comandos Hash

### HSET

**Significado:** H(ash) SET

**Sintaxis:** `HSET key field value [field value ...]`

**Descripción:** Establece el valor de uno o más campos en un hash. Crea el hash si no existe.

```bash
# Ejemplo CLI
HSET scheduler:processing "job-abc" '{"workerId":"worker-1","startedAt":1704067200000}'
```

```typescript
// Uso en QueueManager
await client.hSet(
  QUEUE_KEYS.PROCESSING,
  jobId,
  JSON.stringify({
    workerId,
    startedAt: Date.now(),
  })
);
```

**Uso en el proyecto:** Marcar un job como "en proceso" con metadata del worker.

---

### HDEL

**Significado:** H(ash) DEL(ete)

**Sintaxis:** `HDEL key field [field ...]`

**Descripción:** Elimina uno o más campos del hash.

```bash
# Ejemplo CLI
HDEL scheduler:processing "job-abc"
```

```typescript
// Uso en QueueManager
await client.hDel(QUEUE_KEYS.PROCESSING, jobId);
```

**Uso en el proyecto:** Quitar job del registro de processing cuando completa o falla.

---

### HLEN

**Significado:** H(ash) LEN(gth)

**Sintaxis:** `HLEN key`

**Descripción:** Retorna el número de campos en el hash.

```bash
# Ejemplo CLI
HLEN scheduler:processing
# Retorna: 5
```

```typescript
// Uso en QueueManager
const processingCount = await client.hLen(QUEUE_KEYS.PROCESSING);
```

**Uso en el proyecto:** Contar cuántos jobs están siendo procesados actualmente.

---

## Mapeo de Colas a Comandos

| Cola | Estructura | Comandos Principales |
|------|------------|---------------------|
| `scheduler:queue:priority` | ZSET | ZADD, ZPOPMIN, ZCARD |
| `scheduler:queue:delayed` | ZSET | ZADD, ZRANGEBYSCORE, ZREM, ZCARD |
| `scheduler:processing` | Hash | HSET, HDEL, HLEN |
| `scheduler:queue:dlq` | ZSET | ZADD, ZCARD |

---

## Por qué estas Estructuras

| Necesidad | Estructura | Razón |
|-----------|------------|-------|
| Cola con prioridad | ZSET | Score ordena automáticamente, ZPOPMIN es O(log N) y atómico |
| Jobs diferidos | ZSET | Score = timestamp de ejecución, ZRANGEBYSCORE encuentra jobs "listos" eficientemente |
| Jobs en proceso | Hash | Acceso O(1) por jobId, fácil verificar si un job está en proceso |
| Dead Letter Queue | ZSET | Score = timestamp de fallo, mantiene orden cronológico |

---

## Ejemplos Prácticos

### Flujo completo de un job

```bash
# 1. Encolar job con prioridad HIGH
ZADD scheduler:queue:priority 1704067201000 "job-123"

# 2. Ver la cola
ZRANGE scheduler:queue:priority 0 -1 WITHSCORES

# 3. Worker obtiene siguiente job
ZPOPMIN scheduler:queue:priority
# Retorna: job-123

# 4. Marcar como en proceso
HSET scheduler:processing "job-123" '{"workerId":"w1","startedAt":1704067202000}'

# 5a. Si éxito: quitar de processing
HDEL scheduler:processing "job-123"

# 5b. Si falla definitivamente: mover a DLQ
ZADD scheduler:queue:dlq 1704067300000 '{"jobId":"job-123","reason":"Max retries"}'
HDEL scheduler:processing "job-123"
```

### Job diferido

```bash
# 1. Encolar para ejecutar en 5 minutos
ZADD scheduler:queue:delayed 1704067500000 "job-456:HIGH"

# 2. Cada segundo, buscar jobs listos
ZRANGEBYSCORE scheduler:queue:delayed 0 1704067500000

# 3. Cuando hay jobs listos, promoverlos
ZADD scheduler:queue:priority 1704067501000 "job-456"
ZREM scheduler:queue:delayed "job-456:HIGH"
```

---

## Complejidad de Operaciones

| Comando | Complejidad | Notas |
|---------|-------------|-------|
| ZADD | O(log N) | N = elementos en el set |
| ZPOPMIN | O(log N) | Atómico |
| ZRANGEBYSCORE | O(log N + M) | M = elementos retornados |
| ZREM | O(log N) | Por elemento |
| ZCARD | O(1) | |
| HSET | O(1) | Por campo |
| HDEL | O(1) | Por campo |
| HLEN | O(1) | |
