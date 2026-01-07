import type { PrismaClient, WebhookEvent, Prisma } from '@prisma/client';

export interface CreateWebhookEventInput {
  jobId: string;
  jobType: string;
  url: string;
  payload: Prisma.InputJsonValue;
  maxAttempts?: number;
}

export class WebhookEventRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateWebhookEventInput): Promise<WebhookEvent> {
    return this.prisma.webhookEvent.create({
      data: {
        jobId: input.jobId,
        jobType: input.jobType,
        url: input.url,
        payload: input.payload,
        maxAttempts: input.maxAttempts ?? 3,
        status: 'pending',
      },
    });
  }

  async findById(id: string): Promise<WebhookEvent | null> {
    return this.prisma.webhookEvent.findUnique({
      where: { id },
    });
  }

  async findPendingRetries(limit: number = 50): Promise<WebhookEvent[]> {
    // Usar raw query para comparar attempts < maxAttempts
    return this.prisma.$queryRaw<WebhookEvent[]>`
      SELECT * FROM webhook_events
      WHERE status IN ('pending', 'retrying')
      AND attempts < "maxAttempts"
      ORDER BY "createdAt" ASC
      LIMIT ${limit}
    `;
  }

  async findByJobId(jobId: string): Promise<WebhookEvent[]> {
    return this.prisma.webhookEvent.findMany({
      where: { jobId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateAttempt(
    id: string,
    data: {
      status: string;
      attempts: number;
      lastStatusCode?: number;
      lastError?: string;
      completedAt?: Date;
    }
  ): Promise<WebhookEvent> {
    return this.prisma.webhookEvent.update({
      where: { id },
      data: {
        ...data,
        lastAttemptAt: new Date(),
      },
    });
  }

  async markSuccess(id: string, statusCode: number): Promise<WebhookEvent> {
    return this.prisma.webhookEvent.update({
      where: { id },
      data: {
        status: 'success',
        lastStatusCode: statusCode,
        lastAttemptAt: new Date(),
        completedAt: new Date(),
      },
    });
  }

  async markFailed(id: string, error: string, statusCode?: number): Promise<WebhookEvent> {
    const event = await this.findById(id);
    if (!event) throw new Error(`WebhookEvent ${id} not found`);

    const newAttempts = event.attempts + 1;
    const isFinalFailure = newAttempts >= event.maxAttempts;

    return this.prisma.webhookEvent.update({
      where: { id },
      data: {
        status: isFinalFailure ? 'failed' : 'retrying',
        attempts: newAttempts,
        lastStatusCode: statusCode,
        lastError: error,
        lastAttemptAt: new Date(),
        completedAt: isFinalFailure ? new Date() : null,
      },
    });
  }
}
