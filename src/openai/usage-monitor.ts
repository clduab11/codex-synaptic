import { randomUUID } from 'node:crypto';

export interface OpenAIUsageEvent {
  id: string;
  timestamp: Date;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

export interface OpenAIUsageSummary {
  totals: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  throughput: {
    windowMs: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    requests: number;
    tokensPerMinute: number;
    tokensPerSecond: number;
    requestsPerMinute: number;
  };
  mostRecent?: OpenAIUsageEvent;
  firstEventAt?: Date;
  lastEventAt?: Date;
}

export class OpenAIUsageMonitor {
  private readonly events: OpenAIUsageEvent[] = [];
  private readonly totals = {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0
  };

  constructor(private readonly maxEvents: number = 500) {}

  recordUsage(event: Omit<OpenAIUsageEvent, 'id' | 'timestamp'> & {
    id?: string;
    timestamp?: Date;
  }): OpenAIUsageEvent {
    const timestamp = event.timestamp ?? new Date();
    const id = event.id ?? event.requestId ?? randomUUID();

    const normalized: OpenAIUsageEvent = {
      id,
      timestamp,
      model: event.model,
      inputTokens: Math.max(0, event.inputTokens ?? 0),
      outputTokens: Math.max(0, event.outputTokens ?? 0),
      totalTokens: Math.max(0, event.totalTokens ?? 0),
      requestId: event.requestId,
      metadata: event.metadata
    };

    this.events.push(normalized);
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }

    this.totals.requests += 1;
    this.totals.inputTokens += normalized.inputTokens;
    this.totals.outputTokens += normalized.outputTokens;
    this.totals.totalTokens += normalized.totalTokens;

    return normalized;
  }

  getSummary(windowMs: number = 5 * 60 * 1000): OpenAIUsageSummary {
    const now = Date.now();
    const windowStart = now - Math.max(windowMs, 1);

    let windowInputTokens = 0;
    let windowOutputTokens = 0;
    let windowTotalTokens = 0;
    let windowRequests = 0;

    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      const event = this.events[i];
      if (event.timestamp.getTime() < windowStart) {
        break;
      }
      windowInputTokens += event.inputTokens;
      windowOutputTokens += event.outputTokens;
      windowTotalTokens += event.totalTokens;
      windowRequests += 1;
    }

    const windowMinutes = windowMs / 60000;
    const tokensPerMinute = windowMinutes > 0 ? windowTotalTokens / windowMinutes : 0;
    const tokensPerSecond = windowMs > 0 ? windowTotalTokens / (windowMs / 1000) : 0;
    const requestsPerMinute = windowMinutes > 0 ? windowRequests / windowMinutes : 0;

    return {
      totals: { ...this.totals },
      throughput: {
        windowMs,
        inputTokens: windowInputTokens,
        outputTokens: windowOutputTokens,
        totalTokens: windowTotalTokens,
        requests: windowRequests,
        tokensPerMinute,
        tokensPerSecond,
        requestsPerMinute
      },
      mostRecent: this.events[this.events.length - 1],
      firstEventAt: this.events.length ? this.events[0].timestamp : undefined,
      lastEventAt: this.events.length ? this.events[this.events.length - 1].timestamp : undefined
    };
  }

  getEvents(limit: number = 20): OpenAIUsageEvent[] {
    const safeLimit = Math.max(1, Math.min(limit, this.maxEvents));
    return this.events.slice(-safeLimit).map((event) => ({
      ...event,
      timestamp: new Date(event.timestamp)
    }));
  }

  reset(): void {
    this.events.length = 0;
    this.totals.requests = 0;
    this.totals.inputTokens = 0;
    this.totals.outputTokens = 0;
    this.totals.totalTokens = 0;
  }

  hasData(): boolean {
    return this.events.length > 0;
  }
}
