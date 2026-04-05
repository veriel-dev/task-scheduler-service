import type { JobHandler } from '../../core/worker/JobProcessor.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const imageHandler: JobHandler = async (job) => {
  const payload = job.payload as Record<string, unknown>;
  const delay = 2000 + Math.random() * 2000;
  await sleep(delay);

  if (payload.shouldFail) {
    throw new Error('ImageMagick process crashed: out of memory');
  }

  return {
    resized: true,
    dimensions: '800x600',
    format: 'webp',
    processingTime: `${delay.toFixed(0)}ms`,
  };
};
