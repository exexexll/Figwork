/**
 * Simple logger that respects environment
 */
const isDevelopment = process.env.NODE_ENV !== 'production';

export const logger = {
  debug: (...args: unknown[]) => {
    if (isDevelopment) {
      console.log('[DEBUG]', ...args);
    }
  },

  info: (...args: unknown[]) => {
    console.log('[INFO]', ...args);
  },

  warn: (...args: unknown[]) => {
    console.warn('[WARN]', ...args);
  },

  error: (...args: unknown[]) => {
    console.error('[ERROR]', ...args);
  },

  /**
   * Log timing information for performance monitoring
   */
  timing: (label: string, durationMs: number) => {
    if (isDevelopment) {
      console.log(`[TIMING] ${label}: ${durationMs}ms`);
    }
  },
};
