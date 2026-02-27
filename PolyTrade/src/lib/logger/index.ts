/**
 * Structured Logger with Winston
 * Provides correlation IDs and service-specific child loggers
 */

import winston from 'winston';
import { randomUUID } from 'crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: any;
}

/**
 * Custom log format with timestamp, level, message, and context
 */
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, correlationId, service, ...context }) => {
    const base = `${timestamp} [${level.toUpperCase()}]${service ? ` [${service}]` : ''}${correlationId ? ` [${correlationId}]` : ''}: ${message}`;
    
    // Add context if present
    const hasContext = Object.keys(context).length > 0;
    if (hasContext) {
      return `${base} ${JSON.stringify(context)}`;
    }
    
    return base;
  })
);

/**
 * Logger class with correlation ID support
 */
export class Logger {
  private logger: winston.Logger;
  private correlationId?: string;
  private service?: string;

  constructor(options: {
    level?: LogLevel;
    correlationId?: string;
    service?: string;
  } = {}) {
    this.correlationId = options.correlationId;
    this.service = options.service;
    
    this.logger = winston.createLogger({
      level: options.level || 'info',
      format: customFormat,
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            customFormat
          ),
        }),
        // File transport for production
        ...(process.env.NODE_ENV === 'production' ? [
          new winston.transports.File({ 
            filename: 'logs/error.log', 
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
          }),
          new winston.transports.File({ 
            filename: 'logs/combined.log',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
          }),
        ] : []),
      ],
    });
  }

  /**
   * Create a child logger with specific service name
   */
  child(service: string, correlationId?: string): Logger {
    return new Logger({
      level: this.logger.level as LogLevel,
      correlationId: correlationId || this.correlationId,
      service,
    });
  }

  /**
   * Create a logger with new correlation ID
   */
  withCorrelationId(correlationId?: string): Logger {
    return new Logger({
      level: this.logger.level as LogLevel,
      correlationId: correlationId || randomUUID(),
      service: this.service,
    });
  }

  /**
   * Log debug message
   */
  debug(message: string, context?: LogContext): void {
    this.logger.debug(message, {
      ...context,
      correlationId: this.correlationId,
      service: this.service,
    });
  }

  /**
   * Log info message
   */
  info(message: string, context?: LogContext): void {
    this.logger.info(message, {
      ...context,
      correlationId: this.correlationId,
      service: this.service,
    });
  }

  /**
   * Log warning message
   */
  warn(message: string, context?: LogContext): void {
    this.logger.warn(message, {
      ...context,
      correlationId: this.correlationId,
      service: this.service,
    });
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error | unknown, context?: LogContext): void {
    const errorContext = error instanceof Error ? {
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
    } : error ? { error } : {};
    
    this.logger.error(message, {
      ...errorContext,
      ...context,
      correlationId: this.correlationId,
      service: this.service,
    });
  }

  /**
   * Set log level
   */
  setLevel(level: LogLevel): void {
    this.logger.level = level;
  }

  /**
   * Get current log level
   */
  getLevel(): string {
    return this.logger.level;
  }
}

/**
 * Create default logger instance
 */
export function createLogger(options: {
  level?: LogLevel;
  service?: string;
} = {}): Logger {
  return new Logger({
    level: options.level || (process.env.LOG_LEVEL as LogLevel) || 'info',
    service: options.service,
  });
}

/**
 * Generate a new correlation ID
 */
export function generateCorrelationId(): string {
  return randomUUID();
}
