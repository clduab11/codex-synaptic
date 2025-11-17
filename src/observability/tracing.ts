/**
 * Distributed tracing with OpenTelemetry
 * Provides end-to-end request tracing and performance monitoring
 */

import { trace, context, SpanStatusCode, type Span } from "@opentelemetry/api";
import { log } from "./logger.js";

// Placeholder types for OpenTelemetry (to be implemented with correct SDK versions)
type NodeTracerProvider = any;

/**
 * Initialize OpenTelemetry tracing
 * NOTE: Full OpenTelemetry implementation requires compatible SDK versions.
 * This is a placeholder that can be enhanced with proper tracing configuration.
 */
export function initializeTracing(): NodeTracerProvider {
  log.info("OpenTelemetry tracing placeholder initialized");
  log.warn(
    "Full OpenTelemetry tracing requires additional configuration. See docs/PRODUCTION_OPERATIONS.md",
  );

  // Return a placeholder provider
  return {
    initialized: true,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get the global tracer instance
 */
export function getTracer(name: string = "codex-synaptic") {
  return trace.getTracer(name);
}

/**
 * Create a traced span for an operation
 */
export async function traced<T>(
  operationName: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  const tracer = getTracer();
  const span = tracer.startSpan(operationName);

  if (attributes) {
    Object.entries(attributes).forEach(([key, value]) => {
      span.setAttribute(key, value);
    });
  }

  try {
    const result = await context.with(
      trace.setSpan(context.active(), span),
      () => fn(span),
    );
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error: any) {
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Create a child span within the current context
 */
export function startSpan(
  name: string,
  attributes?: Record<string, string | number | boolean>,
): Span {
  const tracer = getTracer();
  const span = tracer.startSpan(name);

  if (attributes) {
    Object.entries(attributes).forEach(([key, value]) => {
      span.setAttribute(key, value);
    });
  }

  return span;
}

/**
 * Decorator for tracing class methods
 */
export function Traced(operationName?: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    const traceName =
      operationName || `${target.constructor.name}.${propertyKey}`;

    descriptor.value = async function (...args: any[]) {
      return traced(
        traceName,
        async (span) => {
          span.setAttribute("method", propertyKey);
          span.setAttribute("class", target.constructor.name);
          return originalMethod.apply(this, args);
        },
        {
          component: target.constructor.name,
        },
      );
    };

    return descriptor;
  };
}

/**
 * Add event to current active span
 */
export function addSpanEvent(
  name: string,
  attributes?: Record<string, string | number | boolean>,
): void {
  const span = trace.getActiveSpan();
  if (span) {
    span.addEvent(name, attributes);
  }
}

/**
 * Set attribute on current active span
 */
export function setSpanAttribute(
  key: string,
  value: string | number | boolean,
): void {
  const span = trace.getActiveSpan();
  if (span) {
    span.setAttribute(key, value);
  }
}

/**
 * Record exception in current active span
 */
export function recordSpanException(error: Error): void {
  const span = trace.getActiveSpan();
  if (span) {
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
  }
}
