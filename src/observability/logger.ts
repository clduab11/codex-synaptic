/**
 * Production-grade structured logging with correlation IDs
 * Implements centralized logging with Winston and request tracing
 */

import winston from "winston";
import { AsyncLocalStorage } from "async_hooks";

/**
 * Async context storage for correlation IDs
 */
export const correlationContext = new AsyncLocalStorage<{
  correlationId: string;
  sessionId?: string;
  userId?: string;
  agentId?: string;
}>();

/**
 * Generate a unique correlation ID
 */
export function generateCorrelationId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Custom format that includes correlation ID from context
 */
const correlationFormat = winston.format((info) => {
  const context = correlationContext.getStore();
  if (context) {
    info.correlationId = context.correlationId;
    if (context.sessionId) info.sessionId = context.sessionId;
    if (context.userId) info.userId = context.userId;
    if (context.agentId) info.agentId = context.agentId;
  }
  return info;
});

/**
 * Winston logger instance with structured output
 */
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
    correlationFormat(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  defaultMeta: {
    service: "codex-synaptic",
    environment: process.env.NODE_ENV || "development",
  },
  transports: [
    // Console transport for development
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const correlationId = meta.correlationId
            ? `[${meta.correlationId}]`
            : "";
          const agentId = meta.agentId ? `[agent:${meta.agentId}]` : "";
          const metaStr = Object.keys(meta).length
            ? JSON.stringify(
                Object.fromEntries(
                  Object.entries(meta).filter(
                    ([k]) =>
                      ![
                        "correlationId",
                        "agentId",
                        "sessionId",
                        "userId",
                      ].includes(k),
                  ),
                ),
              )
            : "";
          return `${timestamp} ${level} ${correlationId}${agentId} ${message} ${metaStr}`;
        }),
      ),
    }),
  ],
});

// Add file transports for production
if (process.env.NODE_ENV === "production") {
  logger.add(
    new winston.transports.File({
      filename: "logs/error.log",
      level: "error",
      maxsize: 10485760, // 10MB
      maxFiles: 5,
    }),
  );

  logger.add(
    new winston.transports.File({
      filename: "logs/combined.log",
      maxsize: 10485760, // 10MB
      maxFiles: 10,
    }),
  );
}

/**
 * Wraps an async function with correlation context
 */
export function withCorrelation<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  contextData?: Partial<{
    correlationId: string;
    sessionId: string;
    userId: string;
    agentId: string;
  }>,
): T {
  return (async (...args: any[]) => {
    const context = {
      correlationId: contextData?.correlationId || generateCorrelationId(),
      ...(contextData?.sessionId && { sessionId: contextData.sessionId }),
      ...(contextData?.userId && { userId: contextData.userId }),
      ...(contextData?.agentId && { agentId: contextData.agentId }),
    };

    return correlationContext.run(context, () => fn(...args));
  }) as T;
}

/**
 * Log levels with correlation support
 */
export const log = {
  error: (message: string, meta?: Record<string, any>) => {
    logger.error(message, meta);
  },
  warn: (message: string, meta?: Record<string, any>) => {
    logger.warn(message, meta);
  },
  info: (message: string, meta?: Record<string, any>) => {
    logger.info(message, meta);
  },
  debug: (message: string, meta?: Record<string, any>) => {
    logger.debug(message, meta);
  },
  trace: (message: string, meta?: Record<string, any>) => {
    logger.silly(message, meta);
  },
};

/**
 * Performance logging utility
 */
export class PerformanceLogger {
  private startTime: number;
  private checkpoints: Map<string, number> = new Map();

  constructor(private operation: string) {
    this.startTime = performance.now();
    log.debug(`Starting operation: ${operation}`);
  }

  checkpoint(name: string): void {
    const elapsed = performance.now() - this.startTime;
    this.checkpoints.set(name, elapsed);
    log.debug(`Checkpoint ${name} in ${this.operation}`, {
      elapsed: `${elapsed.toFixed(2)}ms`,
    });
  }

  end(meta?: Record<string, any>): number {
    const totalTime = performance.now() - this.startTime;
    const checkpointData = Object.fromEntries(this.checkpoints);

    log.info(`Completed operation: ${this.operation}`, {
      duration: `${totalTime.toFixed(2)}ms`,
      checkpoints: checkpointData,
      ...meta,
    });

    return totalTime;
  }
}
