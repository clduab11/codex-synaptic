/**
 * Comprehensive error handling system for Codex-Synaptic
 */

export enum ErrorCode {
  // System errors
  SYSTEM_NOT_INITIALIZED = 'SYSTEM_NOT_INITIALIZED',
  SYSTEM_SHUTDOWN = 'SYSTEM_SHUTDOWN',
  SYSTEM_OVERLOAD = 'SYSTEM_OVERLOAD',
  LAUNCH_GATE_FAILURE = 'LAUNCH_GATE_FAILURE',
  DOCTOR_CHECKS_FAILED = 'DOCTOR_CHECKS_FAILED',
  
  // Agent errors
  AGENT_NOT_FOUND = 'AGENT_NOT_FOUND',
  AGENT_UNAVAILABLE = 'AGENT_UNAVAILABLE',
  AGENT_EXECUTION_FAILED = 'AGENT_EXECUTION_FAILED',
  AGENT_TIMEOUT = 'AGENT_TIMEOUT',
  
  // Task errors
  TASK_NOT_FOUND = 'TASK_NOT_FOUND',
  TASK_INVALID = 'TASK_INVALID',
  TASK_TIMEOUT = 'TASK_TIMEOUT',
  TASK_FAILED = 'TASK_FAILED',
  
  // Network errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  
  // Resource errors
  RESOURCE_EXHAUSTED = 'RESOURCE_EXHAUSTED',
  MEMORY_LIMIT_EXCEEDED = 'MEMORY_LIMIT_EXCEEDED',
  
  // Consensus errors
  CONSENSUS_FAILED = 'CONSENSUS_FAILED',
  CONSENSUS_TIMEOUT = 'CONSENSUS_TIMEOUT',
  
  // Bridge errors
  BRIDGE_ERROR = 'BRIDGE_ERROR',
  MCP_ERROR = 'MCP_ERROR',
  A2A_ERROR = 'A2A_ERROR'
}

export class CodexSynapticError extends Error {
  public readonly code: ErrorCode;
  public readonly timestamp: Date;
  public readonly context?: Record<string, any>;
  public readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    context?: Record<string, any>,
    retryable: boolean = false
  ) {
    super(message);
    this.name = 'CodexSynapticError';
    this.code = code;
    this.timestamp = new Date();
    this.context = context;
    this.retryable = retryable;

    // Maintains proper stack trace for where our error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CodexSynapticError);
    }
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      timestamp: this.timestamp.toISOString(),
      context: this.context,
      retryable: this.retryable,
      stack: this.stack
    };
  }
}

export class SystemError extends CodexSynapticError {
  constructor(message: string, context?: Record<string, any>) {
    super(ErrorCode.SYSTEM_NOT_INITIALIZED, message, context, false);
    this.name = 'SystemError';
  }
}

export class CliGateError extends CodexSynapticError {
  constructor(
    code: ErrorCode.LAUNCH_GATE_FAILURE | ErrorCode.DOCTOR_CHECKS_FAILED,
    message: string,
    context?: Record<string, any>
  ) {
    super(code, message, context, false);
    this.name = 'CliGateError';
  }
}

export class AgentError extends CodexSynapticError {
  constructor(code: ErrorCode, message: string, context?: Record<string, any>, retryable: boolean = true) {
    super(code, message, context, retryable);
    this.name = 'AgentError';
  }
}

export class TaskError extends CodexSynapticError {
  constructor(code: ErrorCode, message: string, context?: Record<string, any>, retryable: boolean = true) {
    super(code, message, context, retryable);
    this.name = 'TaskError';
  }
}

export class ConsensusError extends CodexSynapticError {
  constructor(message: string, context?: Record<string, any>) {
    super(ErrorCode.CONSENSUS_FAILED, message, context, true);
    this.name = 'ConsensusError';
  }
}

export class BridgeError extends CodexSynapticError {
  constructor(code: ErrorCode, message: string, context?: Record<string, any>) {
    super(code, message, context, true);
    this.name = 'BridgeError';
  }
}

/**
 * Circuit breaker for handling failures gracefully
 */
export class CircuitBreaker {
  private failures: number = 0;
  private lastFailureTime?: Date;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

  constructor(
    private readonly failureThreshold: number = 5,
    private readonly recoveryTimeout: number = 60000,
    private readonly halfOpenMaxCalls: number = 3
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (this.shouldAttemptReset()) {
        this.state = 'HALF_OPEN';
      } else {
        throw new CodexSynapticError(
          ErrorCode.SYSTEM_OVERLOAD,
          'Circuit breaker is OPEN',
          { failures: this.failures, state: this.state },
          true
        );
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private shouldAttemptReset(): boolean {
    return !!this.lastFailureTime &&
           Date.now() - this.lastFailureTime.getTime() >= this.recoveryTimeout;
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = 'CLOSED';
    this.lastFailureTime = undefined;
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = new Date();

    if (this.state === 'HALF_OPEN' || this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  getState() {
    return {
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime
    };
  }
}

/**
 * Retry mechanism with exponential backoff
 */
export class RetryManager {
  static async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelayMs: number = 1000,
    maxDelayMs: number = 30000
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (attempt === maxRetries) {
          break;
        }

        // Don't retry non-retryable errors
        if (error instanceof CodexSynapticError && !error.retryable) {
          throw error;
        }

        // Calculate delay with exponential backoff and jitter
        const delay = Math.min(
          baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000,
          maxDelayMs
        );

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError!;
  }
}

/**
 * Global error handler for unhandled errors
 */
export class GlobalErrorHandler {
  private static instance: GlobalErrorHandler;
  private errorHandlers: Map<string, (error: Error) => void> = new Map();

  static getInstance(): GlobalErrorHandler {
    if (!GlobalErrorHandler.instance) {
      GlobalErrorHandler.instance = new GlobalErrorHandler();
    }
    return GlobalErrorHandler.instance;
  }

  initialize(): void {
    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      this.handleError('uncaughtException', error);
    });

    process.on('unhandledRejection', (reason, promise) => {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      console.error('Unhandled Rejection at:', promise, 'reason:', error);
      this.handleError('unhandledRejection', error);
    });
  }

  registerHandler(type: string, handler: (error: Error) => void): void {
    this.errorHandlers.set(type, handler);
  }

  private handleError(type: string, error: Error): void {
    const handler = this.errorHandlers.get(type);
    if (handler) {
      try {
        handler(error);
      } catch (handlerError) {
        console.error('Error in error handler:', handlerError);
      }
    }
  }
}
