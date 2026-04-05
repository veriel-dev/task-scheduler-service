import type { JobService } from '../services/job.service.js';
import type { ScheduleService } from '../services/schedule.service.js';
import type { DemoEventBus } from './DemoEventBus.js';

interface ScenarioStep {
  delayMs: number;
  action: () => Promise<void>;
}

export class DemoScenario {
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly jobService: JobService,
    private readonly scheduleService: ScheduleService,
    private readonly eventBus: DemoEventBus
  ) {}

  start(): void {
    const steps: ScenarioStep[] = [
      {
        delayMs: 2000,
        action: () => this.createJob('Send welcome email', 'email.send', 'NORMAL', {
          to: 'alice@example.com',
          subject: 'Welcome!',
        }),
      },
      {
        delayMs: 4000,
        action: () => this.createJob('Generate Q1 report', 'report.generate', 'HIGH', {
          quarter: 'Q1',
          year: 2026,
        }),
      },
      {
        delayMs: 6000,
        action: () => this.createJob('Resize avatar', 'image.resize', 'LOW', {
          source: 'avatar.png',
          width: 800,
        }),
      },
      {
        delayMs: 9000,
        action: async () => {
          await this.createJob('Order confirmation', 'email.send', 'NORMAL', {
            to: 'bob@example.com',
            subject: 'Order #1234',
          });
          await this.createJob('Password reset', 'email.send', 'NORMAL', {
            to: 'carol@example.com',
            subject: 'Reset password',
          });
          await this.createJob('Invoice email', 'email.send', 'NORMAL', {
            to: 'dave@example.com',
            subject: 'Invoice #567',
          });
        },
      },
      {
        delayMs: 12000,
        action: () => this.createJob('Process banner (will fail)', 'image.resize', 'NORMAL', {
          source: 'banner-8k.png',
          width: 3840,
          shouldFail: true,
        }),
      },
      {
        delayMs: 16000,
        action: () => this.createJob('URGENT: Alert notification', 'email.send', 'CRITICAL', {
          to: 'admin@example.com',
          subject: 'System Alert',
        }),
      },
      {
        delayMs: 22000,
        action: () => this.createSchedule(),
      },
    ];

    for (const step of steps) {
      const timer = setTimeout(() => void step.action(), step.delayMs);
      this.timers.push(timer);
    }
  }

  stop(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers = [];
  }

  private async createJob(
    name: string,
    type: string,
    priority: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW',
    payload: Record<string, unknown>
  ): Promise<void> {
    const job = await this.jobService.create({
      name,
      type,
      priority,
      payload,
      maxRetries: 3,
      retryDelay: 1000,
    });

    this.eventBus.push({
      timestamp: new Date(),
      jobId: job.id,
      jobType: type,
      status: 'CREATED',
      message: name,
    });
  }

  private async createSchedule(): Promise<void> {
    await this.scheduleService.create({
      name: 'Periodic report generation',
      cronExpr: '*/30 * * * * *',
      timezone: 'UTC',
      jobType: 'report.generate',
      jobPayload: { type: 'periodic', auto: true },
      jobPriority: 'NORMAL',
      enabled: true,
    });

    this.eventBus.push({
      timestamp: new Date(),
      jobId: 'schedule',
      jobType: 'report.generate',
      status: 'CREATED',
      message: 'CRON: */30s report.generate',
    });
  }
}
