/**
 * Performance monitoring and profiling utilities
 * Provides detailed performance tracking and bottleneck identification
 */

import { performance, PerformanceObserver } from "perf_hooks";
import { log } from "../observability/logger.js";
import { metrics } from "../observability/metrics.js";

/**
 * Performance profile entry
 */
export interface PerformanceProfile {
  name: string;
  duration: number;
  startTime: number;
  endTime: number;
  memory?: {
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  metadata?: Record<string, any>;
}

/**
 * Performance profiler
 */
export class Profiler {
  private profiles: Map<string, PerformanceProfile> = new Map();
  private startMarks: Map<string, number> = new Map();

  /**
   * Start profiling an operation
   */
  start(name: string, metadata?: Record<string, any>): void {
    const startTime = performance.now();
    this.startMarks.set(name, startTime);

    if (metadata) {
      this.profiles.set(name, {
        name,
        duration: 0,
        startTime,
        endTime: 0,
        metadata,
      });
    }

    log.debug(`Profiler started: ${name}`);
  }

  /**
   * End profiling an operation
   */
  end(name: string, metadata?: Record<string, any>): PerformanceProfile {
    const endTime = performance.now();
    const startTime = this.startMarks.get(name);

    if (!startTime) {
      throw new Error(`Profiler: No start mark found for '${name}'`);
    }

    const duration = endTime - startTime;
    const memoryUsage = process.memoryUsage();

    const profile: PerformanceProfile = {
      name,
      duration,
      startTime,
      endTime,
      memory: {
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        external: memoryUsage.external,
      },
      metadata: {
        ...this.profiles.get(name)?.metadata,
        ...metadata,
      },
    };

    this.profiles.set(name, profile);
    this.startMarks.delete(name);

    log.debug(`Profiler ended: ${name}`, {
      duration: `${duration.toFixed(2)}ms`,
    });

    return profile;
  }

  /**
   * Measure a synchronous function
   */
  measure<T>(name: string, fn: () => T, metadata?: Record<string, any>): T {
    this.start(name, metadata);
    try {
      const result = fn();
      this.end(name);
      return result;
    } catch (error) {
      this.end(name, { error: true });
      throw error;
    }
  }

  /**
   * Measure an asynchronous function
   */
  async measureAsync<T>(
    name: string,
    fn: () => Promise<T>,
    metadata?: Record<string, any>,
  ): Promise<T> {
    this.start(name, metadata);
    try {
      const result = await fn();
      this.end(name);
      return result;
    } catch (error) {
      this.end(name, { error: true });
      throw error;
    }
  }

  /**
   * Get all profiles
   */
  getProfiles(): PerformanceProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Get a specific profile
   */
  getProfile(name: string): PerformanceProfile | undefined {
    return this.profiles.get(name);
  }

  /**
   * Clear all profiles
   */
  clear(): void {
    this.profiles.clear();
    this.startMarks.clear();
  }

  /**
   * Generate performance report
   */
  generateReport(): {
    totalProfiles: number;
    slowestOperations: PerformanceProfile[];
    averageDuration: number;
    totalDuration: number;
  } {
    const profiles = this.getProfiles();

    if (profiles.length === 0) {
      return {
        totalProfiles: 0,
        slowestOperations: [],
        averageDuration: 0,
        totalDuration: 0,
      };
    }

    const totalDuration = profiles.reduce((sum, p) => sum + p.duration, 0);
    const averageDuration = totalDuration / profiles.length;
    const slowestOperations = [...profiles]
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10);

    return {
      totalProfiles: profiles.length,
      slowestOperations,
      averageDuration,
      totalDuration,
    };
  }
}

/**
 * Global profiler instance
 */
export const profiler = new Profiler();

/**
 * Decorator for automatic profiling
 */
export function Profile(name?: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    const profileName = name || `${target.constructor.name}.${propertyKey}`;

    if (originalMethod.constructor.name === "AsyncFunction") {
      descriptor.value = async function (...args: any[]) {
        return profiler.measureAsync(profileName, () =>
          originalMethod.apply(this, args),
        );
      };
    } else {
      descriptor.value = function (...args: any[]) {
        return profiler.measure(profileName, () =>
          originalMethod.apply(this, args),
        );
      };
    }

    return descriptor;
  };
}

/**
 * Memory profiler
 */
export class MemoryProfiler {
  private snapshots: Array<{
    timestamp: number;
    memory: NodeJS.MemoryUsage;
    label?: string;
  }> = [];

  /**
   * Take a memory snapshot
   */
  snapshot(label?: string): NodeJS.MemoryUsage {
    const memory = process.memoryUsage();
    this.snapshots.push({
      timestamp: Date.now(),
      memory,
      label,
    });

    log.debug("Memory snapshot taken", {
      label,
      heapUsed: `${(memory.heapUsed / 1024 / 1024).toFixed(2)} MB`,
    });

    return memory;
  }

  /**
   * Get memory growth between snapshots
   */
  getGrowth(
    fromIndex: number = 0,
    toIndex?: number,
  ): {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  } {
    const from = this.snapshots[fromIndex];
    const to = this.snapshots[toIndex ?? this.snapshots.length - 1];

    if (!from || !to) {
      throw new Error("Invalid snapshot indices");
    }

    return {
      heapUsed: to.memory.heapUsed - from.memory.heapUsed,
      heapTotal: to.memory.heapTotal - from.memory.heapTotal,
      external: to.memory.external - from.memory.external,
      rss: to.memory.rss - from.memory.rss,
    };
  }

  /**
   * Check for memory leaks
   */
  detectLeaks(thresholdMB: number = 50): boolean {
    if (this.snapshots.length < 2) {
      return false;
    }

    const growth = this.getGrowth();
    const growthMB = growth.heapUsed / 1024 / 1024;

    if (growthMB > thresholdMB) {
      log.warn("Potential memory leak detected", {
        growthMB: growthMB.toFixed(2),
        threshold: thresholdMB,
      });
      return true;
    }

    return false;
  }

  /**
   * Get all snapshots
   */
  getSnapshots() {
    return this.snapshots;
  }

  /**
   * Clear snapshots
   */
  clear(): void {
    this.snapshots = [];
  }
}

/**
 * Global memory profiler instance
 */
export const memoryProfiler = new MemoryProfiler();

/**
 * CPU profiler (using sampling)
 */
export class CPUProfiler {
  private samples: number[] = [];
  private interval?: NodeJS.Timeout;
  private startUsage?: NodeJS.CpuUsage;

  /**
   * Start CPU profiling
   */
  start(sampleIntervalMs: number = 100): void {
    this.startUsage = process.cpuUsage();
    this.samples = [];

    this.interval = setInterval(() => {
      const usage = process.cpuUsage(this.startUsage);
      const cpuPercent =
        ((usage.user + usage.system) / 1000000 / (sampleIntervalMs / 1000)) *
        100;
      this.samples.push(cpuPercent);
    }, sampleIntervalMs);

    log.info("CPU profiling started", {
      sampleInterval: `${sampleIntervalMs}ms`,
    });
  }

  /**
   * Stop CPU profiling
   */
  stop(): {
    averageCpu: number;
    peakCpu: number;
    samples: number;
  } {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }

    const averageCpu =
      this.samples.length > 0
        ? this.samples.reduce((a, b) => a + b, 0) / this.samples.length
        : 0;
    const peakCpu = this.samples.length > 0 ? Math.max(...this.samples) : 0;

    log.info("CPU profiling stopped", {
      averageCpu: `${averageCpu.toFixed(2)}%`,
      peakCpu: `${peakCpu.toFixed(2)}%`,
      samples: this.samples.length,
    });

    return {
      averageCpu,
      peakCpu,
      samples: this.samples.length,
    };
  }

  /**
   * Get samples
   */
  getSamples(): number[] {
    return this.samples;
  }
}

/**
 * Initialize performance monitoring
 */
export function initializePerformanceMonitoring(): void {
  // Create a PerformanceObserver to track slow operations
  const observer = new PerformanceObserver((items) => {
    items.getEntries().forEach((entry) => {
      if (entry.duration > 1000) {
        // Log operations slower than 1s
        log.warn("Slow operation detected", {
          name: entry.name,
          duration: `${entry.duration.toFixed(2)}ms`,
          type: entry.entryType,
        });

        // Record in metrics
        metrics.systemErrorsTotal.inc();
      }
    });
  });

  observer.observe({ entryTypes: ["measure", "function"] });

  log.info("Performance monitoring initialized");
}

/**
 * Benchmark a function
 */
export async function benchmark(
  name: string,
  fn: () => any,
  iterations: number = 1000,
): Promise<{
  name: string;
  iterations: number;
  totalTime: number;
  averageTime: number;
  minTime: number;
  maxTime: number;
  opsPerSecond: number;
}> {
  const times: number[] = [];

  log.info(`Starting benchmark: ${name}`, { iterations });

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    times.push(end - start);
  }

  const totalTime = times.reduce((a, b) => a + b, 0);
  const averageTime = totalTime / iterations;
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const opsPerSecond = 1000 / averageTime;

  const result = {
    name,
    iterations,
    totalTime,
    averageTime,
    minTime,
    maxTime,
    opsPerSecond,
  };

  log.info(`Benchmark completed: ${name}`, {
    avgTime: `${averageTime.toFixed(2)}ms`,
    opsPerSec: opsPerSecond.toFixed(0),
  });

  return result;
}
