import type { JobHandler } from '../../core/worker/JobProcessor.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const emailHandler: JobHandler = async (job) => {
  const payload = job.payload as Record<string, unknown>;
  const delay = 1000 + Math.random() * 2000;
  await sleep(delay);
  const to = typeof payload.to === 'string' ? payload.to : 'user@example.com';
  const subject = typeof payload.subject === 'string' ? payload.subject : 'Notification';
  return {
    sent: true,
    to,
    subject,
    deliveryTime: `${delay.toFixed(0)}ms`,
  };
};
