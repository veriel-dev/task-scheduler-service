import crypto from 'node:crypto';
import type { JobHandler } from '../../core/worker/JobProcessor.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const reportHandler: JobHandler = async () => {
  const delay = 3000 + Math.random() * 2000;
  await sleep(delay);
  return {
    reportId: crypto.randomUUID(),
    pages: Math.floor(Math.random() * 50) + 1,
    format: 'pdf',
    generationTime: `${delay.toFixed(0)}ms`,
  };
};
