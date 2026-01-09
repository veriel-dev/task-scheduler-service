# Prisma ORM

## Schema

**Archivo:** `prisma/schema.prisma`

### Enums

```prisma
enum JobStatus {
  PENDING     // Job creado, esperando ser encolado
  QUEUED      // En cola de Redis, esperando worker
  PROCESSING  // Worker lo está ejecutando
  COMPLETED   // Ejecutado exitosamente
  FAILED      // Falló después de todos los reintentos
  RETRYING    // Falló, esperando reintento
  CANCELLED   // Cancelado manualmente
}

enum JobPriority {
  CRITICAL    // Máxima prioridad (procesado primero)
  HIGH
  NORMAL
  LOW         // Mínima prioridad
}
```

### Modelo Job

```prisma
model Job {
  id       String      @id @default(uuid())
  name     String      // Nombre descriptivo
  type     String      // Handler del job (ej: "email.send")
  payload  Json        // Datos para ejecutar el job
  status   JobStatus   @default(PENDING)
  priority JobPriority @default(NORMAL)

  // Configuración de reintentos
  maxRetries Int @default(3)
  retryCount Int @default(0)
  retryDelay Int @default(1000) // ms para backoff exponencial

  // Ejecución diferida
  scheduledAt DateTime? // Ejecutar después de esta fecha

  // Webhook de notificación
  webhookUrl String?

  // Resultados
  result Json?     // Resultado exitoso
  error  String?   // Mensaje de error

  // Tracking
  startedAt   DateTime?
  completedAt DateTime?
  workerId    String?

  // Relaciones
  schedule   Schedule? @relation(fields: [scheduleId], references: [id])
  scheduleId String?

  // Timestamps
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([status])
  @@index([type])
  @@index([priority])
  @@index([scheduledAt])
  @@index([createdAt])
  @@map("jobs")
}
```

### Modelo Worker

```prisma
model Worker {
  id       String @id @default(uuid())
  name     String
  hostname String
  pid      Int

  status String @default("active")

  concurrency Int @default(1)
  activeJobs  Int @default(0)

  processedCount Int @default(0)
  failedCount    Int @default(0)

  lastHeartbeat DateTime @default(now())

  startedAt DateTime  @default(now())
  stoppedAt DateTime?

  @@index([status])
  @@index([lastHeartbeat])
  @@map("workers")
}
```

## Comandos

```bash
pnpm prisma:generate    # Generar cliente Prisma
pnpm prisma:migrate     # Crear migración
pnpm prisma:push        # Sincronizar sin migración
pnpm prisma:studio      # Abrir GUI
```

## Índices

| Tabla | Índice | Uso |
|-------|--------|-----|
| jobs | status | Filtrar por estado |
| jobs | type | Identificar handlers |
| jobs | priority | Ordenamiento |
| jobs | scheduledAt | Jobs diferidos |
| workers | status | Workers activos |
| workers | lastHeartbeat | Detectar stale |
