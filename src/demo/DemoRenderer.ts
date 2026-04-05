import chalk from 'chalk';
import type { MetricsService, SystemOverview } from '../services/metrics.service.js';
import type { DemoEvent, DemoEventBus } from './DemoEventBus.js';

const ICONS: Record<DemoEvent['status'], string> = {
  CREATED: '▶',
  QUEUED: '◆',
  PROCESSING: '⚙',
  COMPLETED: '✓',
  FAILED: '✗',
  RETRYING: '↻',
  DLQ: '☠',
};

const STATUS_COLOR: Record<DemoEvent['status'], (s: string) => string> = {
  CREATED: chalk.blue,
  QUEUED: chalk.cyan,
  PROCESSING: chalk.yellow,
  COMPLETED: chalk.green,
  FAILED: chalk.red,
  RETRYING: chalk.magenta,
  DLQ: chalk.redBright,
};

export class DemoRenderer {
  private timer: NodeJS.Timeout | null = null;
  private startTime = Date.now();

  constructor(
    private readonly metricsService: MetricsService,
    private readonly eventBus: DemoEventBus
  ) {}

  start(): void {
    process.stdout.write('\x1b[?25l'); // hide cursor
    process.stdout.write('\x1b[2J'); // clear screen
    this.timer = setInterval(() => void this.render(), 1000);
    void this.render();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async render(): Promise<void> {
    let overview: SystemOverview;
    try {
      overview = await this.metricsService.getOverview();
    } catch {
      return; // skip render if metrics unavailable
    }

    const width = Math.max(process.stdout.columns || 80, 70);
    const lines: string[] = [];

    this.renderHeader(lines, width, overview);
    this.renderWorkersAndQueues(lines, width, overview);
    this.renderJobFlow(lines, width);
    this.renderMetrics(lines, width, overview);
    this.renderFooter(lines, width);

    process.stdout.write('\x1b[H'); // move cursor to top
    process.stdout.write(lines.join('\n'));
    // clear remaining screen below
    process.stdout.write('\x1b[J');
  }

  private renderHeader(lines: string[], width: number, overview: SystemOverview): void {
    const inner = width - 2;
    lines.push(chalk.cyan('╔' + '═'.repeat(inner) + '╗'));

    const title = '⚡ TASK SCHEDULER - Live Demo';
    const titlePad = Math.max(0, inner - stripAnsi(title).length);
    lines.push(chalk.cyan('║') + chalk.bold.white(' ' + title) + ' '.repeat(titlePad - 1) + chalk.cyan('║'));

    const healthColor = overview.workers.active > 0 ? chalk.green : chalk.yellow;
    const healthLabel = overview.workers.active > 0 ? 'healthy' : 'no workers';
    const uptime = this.formatUptime(Date.now() - this.startTime);
    const subtitle = `Health: ${healthColor('●')} ${healthLabel}    Uptime: ${uptime}`;
    const subtitlePad = Math.max(0, inner - stripAnsi(subtitle).length);
    lines.push(chalk.cyan('║') + ' ' + subtitle + ' '.repeat(subtitlePad - 1) + chalk.cyan('║'));
  }

  private renderWorkersAndQueues(lines: string[], width: number, overview: SystemOverview): void {
    const inner = width - 2;
    const leftW = Math.floor(inner / 2);
    const rightW = inner - leftW - 1; // -1 for middle separator

    lines.push(chalk.cyan('╠' + '═'.repeat(leftW) + '╦' + '═'.repeat(rightW) + '╣'));

    // Worker section
    const workerLines: string[] = [];
    workerLines.push(chalk.bold(' WORKERS'));
    if (overview.workers.active > 0) {
      workerLines.push(` ${chalk.green('●')} demo-worker ${chalk.green('[ACTIVE]')}`);
    } else {
      workerLines.push(` ${chalk.gray('○')} demo-worker ${chalk.gray('[STARTING]')}`);
    }
    workerLines.push(`   Processed: ${chalk.white(String(overview.workers.totalProcessed))}`);
    workerLines.push(`   Failed:    ${chalk.red(String(overview.workers.totalFailed))}`);
    workerLines.push('');

    // Queue section
    const queueLines: string[] = [];
    const maxQueue = Math.max(overview.queues.priority, overview.queues.delayed, overview.queues.processing, overview.queues.dlq, 1);
    queueLines.push(chalk.bold(' QUEUES'));
    queueLines.push(` Priority:   ${this.bar(overview.queues.priority, maxQueue, 10)} ${String(overview.queues.priority)}`);
    queueLines.push(` Delayed:    ${this.bar(overview.queues.delayed, maxQueue, 10)} ${String(overview.queues.delayed)}`);
    queueLines.push(` Processing: ${this.bar(overview.queues.processing, maxQueue, 10)} ${String(overview.queues.processing)}`);
    queueLines.push(` DLQ:        ${this.bar(overview.queues.dlq, maxQueue, 10, chalk.red)} ${String(overview.queues.dlq)}`);

    const rowCount = Math.max(workerLines.length, queueLines.length);
    for (let i = 0; i < rowCount; i++) {
      const left = workerLines[i] ?? '';
      const right = queueLines[i] ?? '';
      const leftPad = Math.max(0, leftW - stripAnsi(left).length);
      const rightPad = Math.max(0, rightW - stripAnsi(right).length);
      lines.push(
        chalk.cyan('║') + left + ' '.repeat(leftPad) +
        chalk.cyan('║') + right + ' '.repeat(rightPad) +
        chalk.cyan('║')
      );
    }
  }

  private renderJobFlow(lines: string[], width: number): void {
    const inner = width - 2;
    lines.push(chalk.cyan('╠' + '═'.repeat(inner) + '╣'));

    const headerText = chalk.bold(' JOB FLOW');
    const headerPad = Math.max(0, inner - stripAnsi(headerText).length);
    lines.push(chalk.cyan('║') + headerText + ' '.repeat(headerPad) + chalk.cyan('║'));

    const events = this.eventBus.getEvents();
    const maxRows = 10;
    const visible = events.slice(-maxRows);

    if (visible.length === 0) {
      const waiting = chalk.gray('  Waiting for jobs...');
      const waitPad = Math.max(0, inner - stripAnsi(waiting).length);
      lines.push(chalk.cyan('║') + waiting + ' '.repeat(waitPad) + chalk.cyan('║'));
    }

    for (const event of visible) {
      const time = chalk.gray(this.formatTime(event.timestamp));
      const icon = STATUS_COLOR[event.status](ICONS[event.status]);
      const type = chalk.white(event.jobType.padEnd(18));
      const status = STATUS_COLOR[event.status](event.message.padEnd(22));
      const id = chalk.gray(event.jobId.slice(0, 8));

      const line = `  ${time} ${icon} ${type} ${status} ${id}`;
      const linePad = Math.max(0, inner - stripAnsi(line).length);
      lines.push(chalk.cyan('║') + line + ' '.repeat(linePad) + chalk.cyan('║'));
    }

    // fill remaining rows if fewer events
    const emptyRows = maxRows - visible.length;
    for (let i = 0; i < emptyRows && visible.length > 0; i++) {
      lines.push(chalk.cyan('║') + ' '.repeat(inner) + chalk.cyan('║'));
    }
  }

  private renderMetrics(lines: string[], width: number, overview: SystemOverview): void {
    const inner = width - 2;
    lines.push(chalk.cyan('╠' + '═'.repeat(inner) + '╣'));

    const completed = overview.jobs.byStatus['COMPLETED'] ?? 0;
    const failed = overview.jobs.byStatus['FAILED'] ?? 0;
    const dlq = overview.queues.dlq;
    const uptimeSec = (Date.now() - this.startTime) / 1000;
    const throughput = uptimeSec > 0 ? ((completed + failed) / (uptimeSec / 60)).toFixed(1) : '0.0';

    const metricsText =
      chalk.bold(' METRICS') +
      `   Completed: ${chalk.green(String(completed))}` +
      `  Failed: ${chalk.red(String(failed))}` +
      `  DLQ: ${chalk.redBright(String(dlq))}` +
      `  Throughput: ${chalk.white('~' + throughput + '/min')}`;

    const metricsPad = Math.max(0, inner - stripAnsi(metricsText).length);
    lines.push(chalk.cyan('║') + metricsText + ' '.repeat(metricsPad) + chalk.cyan('║'));
  }

  private renderFooter(lines: string[], width: number): void {
    const inner = width - 2;
    lines.push(chalk.cyan('╚' + '═'.repeat(inner) + '╝'));
    lines.push(chalk.gray('  Ctrl+C para salir'));
  }

  private bar(value: number, max: number, barWidth: number, color = chalk.cyan): string {
    const filled = max > 0 ? Math.round((value / max) * barWidth) : 0;
    const empty = barWidth - filled;
    return color('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
  }

  private formatUptime(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (min > 0) return `${String(min)}m ${String(sec)}s`;
    return `${String(sec)}s`;
  }

  private formatTime(date: Date): string {
    return date.toLocaleTimeString('es-ES', { hour12: false });
  }
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}
