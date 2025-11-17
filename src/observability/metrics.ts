/**
 * Metrics collection and monitoring
 * Provides Prometheus-compatible metrics for monitoring system health
 */

import { log } from "./logger.js";

/**
 * Metric types
 */
export enum MetricType {
  COUNTER = "counter",
  GAUGE = "gauge",
  HISTOGRAM = "histogram",
  SUMMARY = "summary",
}

/**
 * Histogram bucket configuration
 */
const RESPONSE_TIME_BUCKETS = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
const PERCENTILES = [0.5, 0.9, 0.95, 0.99];

/**
 * Base metric interface
 */
interface Metric {
  name: string;
  help: string;
  type: MetricType;
  value: number | Map<string, number>;
  labels?: Record<string, string>;
}

/**
 * Metrics registry
 */
class MetricsRegistry {
  private metrics: Map<string, Metric> = new Map();
  private startTime: number = Date.now();

  /**
   * Register a counter metric
   */
  counter(
    name: string,
    help: string,
    labels?: Record<string, string>,
  ): Counter {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, {
        name,
        help,
        type: MetricType.COUNTER,
        value: 0,
        labels,
      });
    }
    return new Counter(name, this);
  }

  /**
   * Register a gauge metric
   */
  gauge(name: string, help: string, labels?: Record<string, string>): Gauge {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, {
        name,
        help,
        type: MetricType.GAUGE,
        value: 0,
        labels,
      });
    }
    return new Gauge(name, this);
  }

  /**
   * Register a histogram metric
   */
  histogram(
    name: string,
    help: string,
    buckets?: number[],
    labels?: Record<string, string>,
  ): Histogram {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, {
        name,
        help,
        type: MetricType.HISTOGRAM,
        value: new Map<string, number>(),
        labels,
      });
    }
    return new Histogram(name, this, buckets || RESPONSE_TIME_BUCKETS);
  }

  /**
   * Get metric by name
   */
  getMetric(name: string): Metric | undefined {
    return this.metrics.get(name);
  }

  /**
   * Update metric value
   */
  updateMetric(name: string, value: number | Map<string, number>): void {
    const metric = this.metrics.get(name);
    if (metric) {
      metric.value = value;
    }
  }

  /**
   * Export metrics in Prometheus format
   */
  exportPrometheus(): string {
    let output = "";

    for (const metric of this.metrics.values()) {
      output += `# HELP ${metric.name} ${metric.help}\n`;
      output += `# TYPE ${metric.name} ${metric.type}\n`;

      if (typeof metric.value === "number") {
        const labels = metric.labels
          ? Object.entries(metric.labels)
              .map(([k, v]) => `${k}="${v}"`)
              .join(",")
          : "";
        output += `${metric.name}${labels ? `{${labels}}` : ""} ${metric.value}\n`;
      } else if (metric.value instanceof Map) {
        for (const [label, value] of metric.value) {
          output += `${metric.name}{${label}} ${value}\n`;
        }
      }

      output += "\n";
    }

    // Add process metrics
    output += `# HELP process_uptime_seconds Process uptime in seconds\n`;
    output += `# TYPE process_uptime_seconds gauge\n`;
    output += `process_uptime_seconds ${(Date.now() - this.startTime) / 1000}\n\n`;

    return output;
  }

  /**
   * Export metrics as JSON
   */
  exportJson(): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [name, metric] of this.metrics) {
      if (metric.value instanceof Map) {
        result[name] = Object.fromEntries(metric.value);
      } else {
        result[name] = metric.value;
      }
    }

    result.process_uptime_seconds = (Date.now() - this.startTime) / 1000;

    return result;
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    for (const metric of this.metrics.values()) {
      if (typeof metric.value === "number") {
        metric.value = 0;
      } else if (metric.value instanceof Map) {
        metric.value.clear();
      }
    }
  }
}

/**
 * Counter metric (monotonically increasing)
 */
class Counter {
  constructor(
    private name: string,
    private registry: MetricsRegistry,
  ) {}

  inc(value: number = 1): void {
    const metric = this.registry.getMetric(this.name);
    if (metric && typeof metric.value === "number") {
      this.registry.updateMetric(this.name, metric.value + value);
    }
  }
}

/**
 * Gauge metric (can increase or decrease)
 */
class Gauge {
  constructor(
    private name: string,
    private registry: MetricsRegistry,
  ) {}

  set(value: number): void {
    this.registry.updateMetric(this.name, value);
  }

  inc(value: number = 1): void {
    const metric = this.registry.getMetric(this.name);
    if (metric && typeof metric.value === "number") {
      this.registry.updateMetric(this.name, metric.value + value);
    }
  }

  dec(value: number = 1): void {
    const metric = this.registry.getMetric(this.name);
    if (metric && typeof metric.value === "number") {
      this.registry.updateMetric(this.name, metric.value - value);
    }
  }
}

/**
 * Histogram metric (distribution of values)
 */
class Histogram {
  private observations: number[] = [];

  constructor(
    private name: string,
    private registry: MetricsRegistry,
    private buckets: number[],
  ) {}

  observe(value: number): void {
    this.observations.push(value);
    this.updateBuckets();
  }

  private updateBuckets(): void {
    const bucketCounts = new Map<string, number>();

    for (const bucket of this.buckets) {
      const count = this.observations.filter((v) => v <= bucket).length;
      bucketCounts.set(`le="${bucket}"`, count);
    }

    bucketCounts.set('le="+Inf"', this.observations.length);
    bucketCounts.set(
      "sum",
      this.observations.reduce((a, b) => a + b, 0),
    );
    bucketCounts.set("count", this.observations.length);

    this.registry.updateMetric(this.name, bucketCounts);
  }

  getPercentile(p: number): number {
    if (this.observations.length === 0) return 0;

    const sorted = [...this.observations].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, index)];
  }

  getStats(): {
    count: number;
    sum: number;
    avg: number;
    p50: number;
    p90: number;
    p95: number;
    p99: number;
  } {
    return {
      count: this.observations.length,
      sum: this.observations.reduce((a, b) => a + b, 0),
      avg:
        this.observations.length > 0
          ? this.observations.reduce((a, b) => a + b, 0) /
            this.observations.length
          : 0,
      p50: this.getPercentile(0.5),
      p90: this.getPercentile(0.9),
      p95: this.getPercentile(0.95),
      p99: this.getPercentile(0.99),
    };
  }
}

/**
 * Global metrics registry
 */
export const metricsRegistry = new MetricsRegistry();

/**
 * Standard application metrics
 */
export const metrics = {
  // Request metrics
  httpRequestsTotal: metricsRegistry.counter(
    "http_requests_total",
    "Total HTTP requests",
  ),
  httpRequestDuration: metricsRegistry.histogram(
    "http_request_duration_ms",
    "HTTP request duration in milliseconds",
  ),
  httpRequestErrors: metricsRegistry.counter(
    "http_request_errors_total",
    "Total HTTP request errors",
  ),

  // Agent metrics
  agentsActive: metricsRegistry.gauge(
    "agents_active",
    "Number of active agents",
  ),
  agentTasksTotal: metricsRegistry.counter(
    "agent_tasks_total",
    "Total tasks processed by agents",
  ),
  agentTaskDuration: metricsRegistry.histogram(
    "agent_task_duration_ms",
    "Agent task duration in milliseconds",
  ),
  agentErrors: metricsRegistry.counter(
    "agent_errors_total",
    "Total agent errors",
  ),

  // Consensus metrics
  consensusProposalsTotal: metricsRegistry.counter(
    "consensus_proposals_total",
    "Total consensus proposals",
  ),
  consensusProposalsActive: metricsRegistry.gauge(
    "consensus_proposals_active",
    "Active consensus proposals",
  ),
  consensusVotesTotal: metricsRegistry.counter(
    "consensus_votes_total",
    "Total consensus votes",
  ),
  consensusDuration: metricsRegistry.histogram(
    "consensus_duration_ms",
    "Consensus decision duration in milliseconds",
  ),

  // Mesh metrics
  meshNodesActive: metricsRegistry.gauge(
    "mesh_nodes_active",
    "Active neural mesh nodes",
  ),
  meshConnectionsTotal: metricsRegistry.gauge(
    "mesh_connections_total",
    "Total neural mesh connections",
  ),
  meshMessagesTotal: metricsRegistry.counter(
    "mesh_messages_total",
    "Total mesh messages processed",
  ),

  // Swarm metrics
  swarmParticlesActive: metricsRegistry.gauge(
    "swarm_particles_active",
    "Active swarm particles",
  ),
  swarmIterations: metricsRegistry.counter(
    "swarm_iterations_total",
    "Total swarm optimization iterations",
  ),
  swarmBestFitness: metricsRegistry.gauge(
    "swarm_best_fitness",
    "Best fitness value found",
  ),

  // System metrics
  systemCpuUsage: metricsRegistry.gauge(
    "system_cpu_usage_percent",
    "CPU usage percentage",
  ),
  systemMemoryUsage: metricsRegistry.gauge(
    "system_memory_usage_bytes",
    "Memory usage in bytes",
  ),
  systemErrorsTotal: metricsRegistry.counter(
    "system_errors_total",
    "Total system errors",
  ),
};

/**
 * Collect system metrics
 */
export function collectSystemMetrics(): void {
  try {
    const usage = process.memoryUsage();
    metrics.systemMemoryUsage.set(usage.heapUsed);

    // CPU usage requires measuring over time
    const startUsage = process.cpuUsage();
    setTimeout(() => {
      const endUsage = process.cpuUsage(startUsage);
      const totalUsage = (endUsage.user + endUsage.system) / 1000000; // Convert to seconds
      metrics.systemCpuUsage.set(totalUsage * 100);
    }, 1000);
  } catch (error: any) {
    log.error("Failed to collect system metrics", { error: error.message });
  }
}

/**
 * Start metrics collection interval
 */
export function startMetricsCollection(
  intervalMs: number = 60000,
): NodeJS.Timeout {
  log.info("Starting metrics collection", { interval: `${intervalMs}ms` });

  const interval = setInterval(() => {
    collectSystemMetrics();
  }, intervalMs);

  // Collect initial metrics
  collectSystemMetrics();

  return interval;
}
