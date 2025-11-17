/**
 * Rate limiting middleware
 * Protects against abuse and DoS attacks
 */

import { log } from "../observability/logger.js";

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  keyGenerator?: (identifier: string) => string; // Custom key generator
  skipSuccessfulRequests?: boolean; // Don't count successful requests
  skipFailedRequests?: boolean; // Don't count failed requests
}

/**
 * Rate limit store interface
 */
interface RateLimitStore {
  increment(key: string): Promise<number>;
  decrement(key: string): Promise<void>;
  reset(key: string): Promise<void>;
  get(key: string): Promise<number>;
}

/**
 * In-memory rate limit store
 */
class MemoryStore implements RateLimitStore {
  private store: Map<string, { count: number; resetAt: number }> = new Map();

  constructor(private windowMs: number) {
    // Cleanup expired entries every minute
    setInterval(() => this.cleanup(), 60000);
  }

  async increment(key: string): Promise<number> {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || entry.resetAt < now) {
      this.store.set(key, {
        count: 1,
        resetAt: now + this.windowMs,
      });
      return 1;
    }

    entry.count++;
    return entry.count;
  }

  async decrement(key: string): Promise<void> {
    const entry = this.store.get(key);
    if (entry && entry.count > 0) {
      entry.count--;
    }
  }

  async reset(key: string): Promise<void> {
    this.store.delete(key);
  }

  async get(key: string): Promise<number> {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || entry.resetAt < now) {
      return 0;
    }

    return entry.count;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetAt < now) {
        this.store.delete(key);
      }
    }
  }
}

/**
 * Rate limiter class
 */
export class RateLimiter {
  private store: RateLimitStore;
  private config: Required<RateLimitConfig>;

  constructor(config: RateLimitConfig) {
    this.config = {
      keyGenerator: (id: string) => `ratelimit:${id}`,
      skipSuccessfulRequests: false,
      skipFailedRequests: false,
      ...config,
    };

    this.store = new MemoryStore(this.config.windowMs);
  }

  /**
   * Check if a request should be rate limited
   */
  async check(identifier: string): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: number;
  }> {
    const key = this.config.keyGenerator(identifier);
    const count = await this.store.increment(key);

    const allowed = count <= this.config.maxRequests;
    const remaining = Math.max(0, this.config.maxRequests - count);
    const resetAt = Date.now() + this.config.windowMs;

    if (!allowed) {
      log.warn("Rate limit exceeded", {
        identifier,
        count,
        limit: this.config.maxRequests,
        window: `${this.config.windowMs}ms`,
      });
    }

    return { allowed, remaining, resetAt };
  }

  /**
   * Reset rate limit for an identifier
   */
  async reset(identifier: string): Promise<void> {
    const key = this.config.keyGenerator(identifier);
    await this.store.reset(key);
  }

  /**
   * Decrement counter (for request retries)
   */
  async decrement(identifier: string): Promise<void> {
    const key = this.config.keyGenerator(identifier);
    await this.store.decrement(key);
  }
}

/**
 * Pre-configured rate limiters
 */
export const rateLimiters = {
  // Global rate limit: 1000 requests per 15 minutes per IP
  global: new RateLimiter({
    windowMs: 15 * 60 * 1000,
    maxRequests: 1000,
  }),

  // API rate limit: 100 requests per minute per user
  api: new RateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 100,
  }),

  // Auth rate limit: 5 login attempts per 15 minutes
  auth: new RateLimiter({
    windowMs: 15 * 60 * 1000,
    maxRequests: 5,
  }),

  // Strict rate limit for sensitive operations: 10 per hour
  strict: new RateLimiter({
    windowMs: 60 * 60 * 1000,
    maxRequests: 10,
  }),
};

/**
 * Rate limit middleware factory for Express
 */
export function createRateLimitMiddleware(limiter: RateLimiter) {
  return async (req: any, res: any, next: () => void): Promise<void> => {
    try {
      // Use IP address or user ID as identifier
      const identifier =
        req.user?.id || req.ip || req.connection.remoteAddress || "unknown";

      const result = await limiter.check(identifier);

      // Set rate limit headers
      res.set({
        "X-RateLimit-Limit": limiter["config"].maxRequests,
        "X-RateLimit-Remaining": result.remaining,
        "X-RateLimit-Reset": new Date(result.resetAt).toISOString(),
      });

      if (!result.allowed) {
        res.status(429).json({
          error: "Too many requests",
          message: "Rate limit exceeded. Please try again later.",
          retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
        });
        return;
      }

      next();
    } catch (error: any) {
      log.error("Rate limiter error", { error: error.message });
      // Fail open - allow request if rate limiter fails
      next();
    }
  };
}
