-- CreateEnum
CREATE TYPE "public"."JobStatus" AS ENUM ('PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETRYING', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."JobPriority" AS ENUM ('CRITICAL', 'HIGH', 'NORMAL', 'LOW');

-- CreateTable
CREATE TABLE "public"."jobs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "public"."JobStatus" NOT NULL DEFAULT 'PENDING',
    "priority" "public"."JobPriority" NOT NULL DEFAULT 'NORMAL',
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "retryDelay" INTEGER NOT NULL DEFAULT 1000,
    "scheduledAt" TIMESTAMP(3),
    "webhookUrl" TEXT,
    "result" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "scheduleId" TEXT,
    "workerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."schedules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cronExpr" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "jobType" TEXT NOT NULL,
    "jobPayload" JSONB NOT NULL,
    "jobPriority" "public"."JobPriority" NOT NULL DEFAULT 'NORMAL',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."dead_letter_jobs" (
    "id" TEXT NOT NULL,
    "originalJobId" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "jobPayload" JSONB NOT NULL,
    "jobPriority" "public"."JobPriority" NOT NULL,
    "failureReason" TEXT NOT NULL,
    "failureCount" INTEGER NOT NULL,
    "lastError" TEXT,
    "errorStack" TEXT,
    "workerId" TEXT,
    "originalCreatedAt" TIMESTAMP(3) NOT NULL,
    "failedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dead_letter_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."workers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "pid" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "concurrency" INTEGER NOT NULL DEFAULT 1,
    "activeJobs" INTEGER NOT NULL DEFAULT 0,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "lastHeartbeat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),

    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jobs_status_idx" ON "public"."jobs"("status");

-- CreateIndex
CREATE INDEX "jobs_type_idx" ON "public"."jobs"("type");

-- CreateIndex
CREATE INDEX "jobs_priority_idx" ON "public"."jobs"("priority");

-- CreateIndex
CREATE INDEX "jobs_scheduledAt_idx" ON "public"."jobs"("scheduledAt");

-- CreateIndex
CREATE INDEX "jobs_scheduleId_idx" ON "public"."jobs"("scheduleId");

-- CreateIndex
CREATE INDEX "jobs_createdAt_idx" ON "public"."jobs"("createdAt");

-- CreateIndex
CREATE INDEX "schedules_enabled_idx" ON "public"."schedules"("enabled");

-- CreateIndex
CREATE INDEX "schedules_nextRunAt_idx" ON "public"."schedules"("nextRunAt");

-- CreateIndex
CREATE INDEX "dead_letter_jobs_jobType_idx" ON "public"."dead_letter_jobs"("jobType");

-- CreateIndex
CREATE INDEX "dead_letter_jobs_failedAt_idx" ON "public"."dead_letter_jobs"("failedAt");

-- CreateIndex
CREATE INDEX "dead_letter_jobs_originalJobId_idx" ON "public"."dead_letter_jobs"("originalJobId");

-- CreateIndex
CREATE INDEX "workers_status_idx" ON "public"."workers"("status");

-- CreateIndex
CREATE INDEX "workers_lastHeartbeat_idx" ON "public"."workers"("lastHeartbeat");

-- AddForeignKey
ALTER TABLE "public"."jobs" ADD CONSTRAINT "jobs_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "public"."schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
