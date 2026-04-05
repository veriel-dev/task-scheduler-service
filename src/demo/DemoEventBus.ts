import { EventEmitter } from 'node:events';

export interface DemoEvent {
  timestamp: Date;
  jobId: string;
  jobType: string;
  status: 'CREATED' | 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'RETRYING' | 'DLQ';
  message: string;
  duration?: number;
}

type DemoEventMap = {
  'job:created': [DemoEvent];
  'job:queued': [DemoEvent];
  'job:processing': [DemoEvent];
  'job:completed': [DemoEvent];
  'job:failed': [DemoEvent];
  'job:retrying': [DemoEvent];
  'job:dlq': [DemoEvent];
};

const MAX_EVENTS = 30;

export class DemoEventBus extends EventEmitter<DemoEventMap> {
  private events: DemoEvent[] = [];

  push(event: DemoEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.events.shift();
    }
    this.emit(`job:${event.status.toLowerCase()}` as keyof DemoEventMap, event);
  }

  getEvents(): readonly DemoEvent[] {
    return this.events;
  }

  clear(): void {
    this.events = [];
  }
}
