import { Cron } from 'croner';

/**
 * CronParser - Wrapper sobre croner para parsear expresiones cron
 * y calcular próximas ejecuciones con soporte de timezone.
 */
export class CronParser {
  /**
   * Valida una expresión cron.
   * @param cronExpr - Expresión cron de 5 campos (min hour dom mon dow)
   * @returns true si es válida, false si no
   */
  static isValid(cronExpr: string): boolean {
    try {
      new Cron(cronExpr, { paused: true });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Calcula la próxima ejecución desde una fecha base.
   * @param cronExpr - Expresión cron (5 campos: min hour dom mon dow)
   * @param timezone - Timezone IANA (ej: 'America/New_York', 'Europe/Madrid')
   * @param fromDate - Fecha base para calcular (default: now)
   * @returns La próxima fecha de ejecución o null si la expresión es inválida
   */
  static getNextRun(cronExpr: string, timezone: string = 'UTC', fromDate?: Date): Date | null {
    try {
      const cron = new Cron(cronExpr, {
        timezone,
        paused: true,
      });

      return cron.nextRun(fromDate) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Calcula las próximas N ejecuciones.
   * @param cronExpr - Expresión cron
   * @param timezone - Timezone IANA
   * @param count - Número de ejecuciones a calcular (default: 5)
   * @param fromDate - Fecha base para calcular
   * @returns Array de fechas de ejecución
   */
  static getNextRuns(
    cronExpr: string,
    timezone: string = 'UTC',
    count: number = 5,
    fromDate?: Date
  ): Date[] {
    try {
      const cron = new Cron(cronExpr, {
        timezone,
        paused: true,
      });

      return cron.nextRuns(count, fromDate);
    } catch {
      return [];
    }
  }

  /**
   * Valida que un timezone sea válido usando Intl.
   * @param timezone - Timezone a validar
   * @returns true si es válido, false si no
   */
  static isValidTimezone(timezone: string): boolean {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Describe una expresión cron en lenguaje humano (básico).
   * @param cronExpr - Expresión cron
   * @returns Descripción legible
   */
  static describe(cronExpr: string): string {
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length < 5) return 'Invalid cron expression';

    const min = parts[0] ?? '*';
    const hour = parts[1] ?? '*';
    const dom = parts[2] ?? '*';
    const mon = parts[3] ?? '*';
    const dow = parts[4] ?? '*';

    // Casos comunes
    if (cronExpr === '* * * * *') return 'Every minute';
    if (cronExpr === '0 * * * *') return 'Every hour';
    if (cronExpr === '0 0 * * *') return 'Every day at midnight';
    if (cronExpr === '0 0 * * 0') return 'Every Sunday at midnight';
    if (cronExpr === '0 0 1 * *') return 'First day of every month at midnight';

    // Patrón: minuto y hora específicos, todos los días
    if (min !== '*' && hour !== '*' && dom === '*' && mon === '*' && dow === '*') {
      return `Every day at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
    }

    // Patrón: cada X minutos
    if (min.startsWith('*/') && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
      const interval = min.substring(2);
      return `Every ${interval} minutes`;
    }

    // Patrón: cada X horas
    if (min === '0' && hour.startsWith('*/') && dom === '*' && mon === '*' && dow === '*') {
      const interval = hour.substring(2);
      return `Every ${interval} hours`;
    }

    // Fallback: retornar la expresión original
    return cronExpr;
  }
}
