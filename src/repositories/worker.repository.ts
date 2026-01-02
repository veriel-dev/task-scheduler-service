import type { PrismaClient, Worker } from '@prisma/client';
import { hostname } from 'os';

export interface CreateWorkerInput {
  name: string;
  concurrency: number;
  pid: number;
}

export interface UpdateWorkerStats {
  processedCount?: number;
  failedCount?: number;
  activeJobs?: number;
}

export class WorkerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async register(input: CreateWorkerInput): Promise<Worker> {
    return this.prisma.worker.create({
      data: {
        name: input.name,
        hostname: hostname(),
        pid: input.pid,
        concurrency: input.concurrency,
        status: 'active',
        lastHeartbeat: new Date(),
      },
    });
  }

  async findById(id: string): Promise<Worker | null> {
    return this.prisma.worker.findUnique({
      where: { id },
    });
  }

  async updateHeartbeat(id: string): Promise<Worker> {
    return this.prisma.worker.update({
      where: { id },
      data: { lastHeartbeat: new Date() },
    });
  }

  async updateStatus(id: string, status: string): Promise<Worker> {
    return this.prisma.worker.update({
      where: { id },
      data: { status },
    });
  }

  async updateStats(id: string, stats: UpdateWorkerStats): Promise<Worker> {
    return this.prisma.worker.update({
      where: { id },
      data: stats,
    });
  }

  async incrementProcessed(id: string): Promise<Worker> {
    return this.prisma.worker.update({
      where: { id },
      data: {
        processedCount: { increment: 1 },
      },
    });
  }

  async incrementFailed(id: string): Promise<Worker> {
    return this.prisma.worker.update({
      where: { id },
      data: {
        failedCount: { increment: 1 },
      },
    });
  }

  async setActiveJobs(id: string, count: number): Promise<Worker> {
    return this.prisma.worker.update({
      where: { id },
      data: { activeJobs: count },
    });
  }

  async stop(id: string): Promise<Worker> {
    return this.prisma.worker.update({
      where: { id },
      data: {
        status: 'stopped',
        stoppedAt: new Date(),
        activeJobs: 0,
      },
    });
  }

  async findStaleWorkers(thresholdMs: number): Promise<Worker[]> {
    const threshold = new Date(Date.now() - thresholdMs);
    return this.prisma.worker.findMany({
      where: {
        status: 'active',
        lastHeartbeat: { lt: threshold },
      },
    });
  }

  async findActiveWorkers(): Promise<Worker[]> {
    return this.prisma.worker.findMany({
      where: {
        status: { in: ['active', 'idle'] },
      },
      orderBy: { startedAt: 'desc' },
    });
  }
}
