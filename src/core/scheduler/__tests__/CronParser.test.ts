import { describe, it, expect } from 'vitest';
import { CronParser } from '../CronParser.js';

describe('CronParser', () => {
  describe('isValid', () => {
    it('should return true for valid cron expressions', () => {
      expect(CronParser.isValid('* * * * *')).toBe(true);
      expect(CronParser.isValid('0 * * * *')).toBe(true);
      expect(CronParser.isValid('0 0 * * *')).toBe(true);
      expect(CronParser.isValid('0 9 * * 1-5')).toBe(true);
      expect(CronParser.isValid('*/5 * * * *')).toBe(true);
      expect(CronParser.isValid('0 0 1 * *')).toBe(true);
      expect(CronParser.isValid('30 4 1,15 * *')).toBe(true);
    });

    it('should return false for invalid cron expressions', () => {
      expect(CronParser.isValid('')).toBe(false);
      expect(CronParser.isValid('invalid')).toBe(false);
      expect(CronParser.isValid('* * *')).toBe(false);
      expect(CronParser.isValid('60 * * * *')).toBe(false);
      expect(CronParser.isValid('* 25 * * *')).toBe(false);
    });
  });

  describe('getNextRun', () => {
    it('should return next run date for valid cron expression', () => {
      const result = CronParser.getNextRun('* * * * *');
      expect(result).toBeInstanceOf(Date);
      expect(result!.getTime()).toBeGreaterThan(Date.now());
    });

    it('should return null for invalid cron expression', () => {
      const result = CronParser.getNextRun('invalid');
      expect(result).toBeNull();
    });

    it('should respect timezone', () => {
      const utcResult = CronParser.getNextRun('0 12 * * *', 'UTC');
      const nyResult = CronParser.getNextRun('0 12 * * *', 'America/New_York');

      expect(utcResult).toBeInstanceOf(Date);
      expect(nyResult).toBeInstanceOf(Date);
      // Different timezones should produce different results
      expect(utcResult!.getTime()).not.toBe(nyResult!.getTime());
    });

    it('should calculate from a specific date', () => {
      const fromDate = new Date('2025-01-15T10:00:00Z');
      const result = CronParser.getNextRun('0 12 * * *', 'UTC', fromDate);

      expect(result).toBeInstanceOf(Date);
      expect(result!.getTime()).toBeGreaterThan(fromDate.getTime());
    });
  });

  describe('getNextRuns', () => {
    it('should return multiple next run dates', () => {
      const results = CronParser.getNextRuns('0 * * * *', 'UTC', 5);

      expect(results).toHaveLength(5);
      results.forEach((date) => {
        expect(date).toBeInstanceOf(Date);
      });

      // Dates should be in ascending order
      for (let i = 1; i < results.length; i++) {
        expect(results[i]!.getTime()).toBeGreaterThan(results[i - 1]!.getTime());
      }
    });

    it('should return empty array for invalid cron expression', () => {
      const results = CronParser.getNextRuns('invalid');
      expect(results).toEqual([]);
    });

    it('should respect count parameter', () => {
      const results3 = CronParser.getNextRuns('* * * * *', 'UTC', 3);
      const results10 = CronParser.getNextRuns('* * * * *', 'UTC', 10);

      expect(results3).toHaveLength(3);
      expect(results10).toHaveLength(10);
    });
  });

  describe('isValidTimezone', () => {
    it('should return true for valid IANA timezones', () => {
      expect(CronParser.isValidTimezone('UTC')).toBe(true);
      expect(CronParser.isValidTimezone('America/New_York')).toBe(true);
      expect(CronParser.isValidTimezone('Europe/London')).toBe(true);
      expect(CronParser.isValidTimezone('Asia/Tokyo')).toBe(true);
      expect(CronParser.isValidTimezone('Europe/Madrid')).toBe(true);
    });

    it('should return false for invalid timezones', () => {
      expect(CronParser.isValidTimezone('')).toBe(false);
      expect(CronParser.isValidTimezone('Invalid/Timezone')).toBe(false);
      expect(CronParser.isValidTimezone('Not/A/Real/Timezone')).toBe(false);
    });
  });

  describe('describe', () => {
    it('should describe common cron expressions', () => {
      expect(CronParser.describe('* * * * *')).toBe('Every minute');
      expect(CronParser.describe('0 * * * *')).toBe('Every hour');
      expect(CronParser.describe('0 0 * * *')).toBe('Every day at midnight');
      expect(CronParser.describe('0 0 * * 0')).toBe('Every Sunday at midnight');
      expect(CronParser.describe('0 0 1 * *')).toBe('First day of every month at midnight');
    });

    it('should describe daily at specific time', () => {
      expect(CronParser.describe('0 9 * * *')).toBe('Every day at 09:00');
      expect(CronParser.describe('30 14 * * *')).toBe('Every day at 14:30');
    });

    it('should describe interval patterns', () => {
      expect(CronParser.describe('*/5 * * * *')).toBe('Every 5 minutes');
      expect(CronParser.describe('*/15 * * * *')).toBe('Every 15 minutes');
    });

    it('should return the expression for complex patterns', () => {
      expect(CronParser.describe('0 9 * * 1-5')).toBe('0 9 * * 1-5');
      expect(CronParser.describe('30 4 1,15 * *')).toBe('30 4 1,15 * *');
    });

    it('should handle invalid expressions', () => {
      expect(CronParser.describe('')).toBe('Invalid cron expression');
      expect(CronParser.describe('* *')).toBe('Invalid cron expression');
    });
  });
});
