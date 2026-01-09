# Docker Compose

## Configuración

**Archivo:** `docker-compose.yml`

```yaml
services:
  db:
    image: postgres:15-alpine
    container_name: scheduler-db
    environment:
      POSTGRES_USER: scheduler
      POSTGRES_PASSWORD: scheduler_dev
      POSTGRES_DB: task_scheduler
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    container_name: scheduler-redis
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

## Servicios

### PostgreSQL 15

| Aspecto | Configuración |
|---------|---------------|
| Imagen | `postgres:15-alpine` |
| Puerto | `5432` |
| Usuario | `scheduler` |
| Password | `scheduler_dev` |
| Base de datos | `task_scheduler` |
| Volumen | `postgres_data` |

**Por qué PostgreSQL 15:**
- Soporte JSONB mejorado para payloads de jobs
- Mejor rendimiento en queries con índices
- Imagen Alpine reduce tamaño (~80MB vs ~400MB)

### Redis 7

| Aspecto | Configuración |
|---------|---------------|
| Imagen | `redis:7-alpine` |
| Puerto | `6379` |
| Volumen | `redis_data` |

**Por qué Redis 7:**
- Sorted Sets para priority queue
- Hashes para tracking de workers
- Persistencia opcional con AOF

## Comandos

```bash
# Iniciar todos los servicios
docker-compose up -d

# Iniciar solo dependencias
docker-compose up -d db redis

# Ver logs
docker-compose logs -f

# Detener servicios
docker-compose down

# Detener y eliminar volúmenes
docker-compose down -v
```

## Variables de Entorno

Las URLs de conexión para desarrollo local:

```env
DATABASE_URL="postgresql://scheduler:scheduler_dev@localhost:5432/task_scheduler"
REDIS_URL="redis://localhost:6379"
```
