/**
 * Security headers and CORS configuration
 * Implements security best practices for HTTP responses
 */

import { log } from "../observability/logger.js";

/**
 * CORS configuration
 */
export interface CorsConfig {
  allowedOrigins: string[];
  allowedMethods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

/**
 * Security headers configuration
 */
export interface SecurityHeadersConfig {
  contentSecurityPolicy?: string;
  strictTransportSecurity?: string;
  xFrameOptions?: string;
  xContentTypeOptions?: string;
  referrerPolicy?: string;
  permissionsPolicy?: string;
}

/**
 * Default production security headers
 */
export const productionSecurityHeaders: SecurityHeadersConfig = {
  // Content Security Policy - prevents XSS attacks
  contentSecurityPolicy:
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; " +
    "font-src 'self' data:; " +
    "connect-src 'self' https://api.openai.com https://api.anthropic.com; " +
    "frame-ancestors 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self'",

  // HSTS - forces HTTPS connections
  strictTransportSecurity: "max-age=31536000; includeSubDomains; preload",

  // Prevent clickjacking
  xFrameOptions: "DENY",

  // Prevent MIME type sniffing
  xContentTypeOptions: "nosniff",

  // Referrer policy
  referrerPolicy: "strict-origin-when-cross-origin",

  // Permissions policy (formerly Feature-Policy)
  permissionsPolicy:
    "geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()",
};

/**
 * Default CORS configuration for production
 */
export const productionCorsConfig: CorsConfig = {
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",") || [
    "https://yourdomain.com",
  ],
  allowedMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  exposedHeaders: [
    "X-RateLimit-Limit",
    "X-RateLimit-Remaining",
    "X-RateLimit-Reset",
  ],
  credentials: true,
  maxAge: 86400, // 24 hours
};

/**
 * CORS middleware
 */
export function corsMiddleware(config: CorsConfig) {
  return (req: any, res: any, next: () => void): void => {
    const origin = req.headers.origin;

    // Check if origin is allowed
    const isAllowedOrigin =
      config.allowedOrigins.includes("*") ||
      (origin && config.allowedOrigins.includes(origin));

    if (isAllowedOrigin) {
      res.setHeader(
        "Access-Control-Allow-Origin",
        config.allowedOrigins.includes("*") ? "*" : origin,
      );

      if (config.credentials) {
        res.setHeader("Access-Control-Allow-Credentials", "true");
      }

      if (config.allowedMethods) {
        res.setHeader(
          "Access-Control-Allow-Methods",
          config.allowedMethods.join(", "),
        );
      }

      if (config.allowedHeaders) {
        res.setHeader(
          "Access-Control-Allow-Headers",
          config.allowedHeaders.join(", "),
        );
      }

      if (config.exposedHeaders) {
        res.setHeader(
          "Access-Control-Expose-Headers",
          config.exposedHeaders.join(", "),
        );
      }

      if (config.maxAge !== undefined) {
        res.setHeader("Access-Control-Max-Age", config.maxAge.toString());
      }
    } else if (origin) {
      log.warn("CORS: Origin not allowed", {
        origin,
        allowed: config.allowedOrigins,
      });
    }

    // Handle preflight requests
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  };
}

/**
 * Security headers middleware
 */
export function securityHeadersMiddleware(config: SecurityHeadersConfig) {
  return (req: any, res: any, next: () => void): void => {
    if (config.contentSecurityPolicy) {
      res.setHeader("Content-Security-Policy", config.contentSecurityPolicy);
    }

    if (config.strictTransportSecurity) {
      res.setHeader(
        "Strict-Transport-Security",
        config.strictTransportSecurity,
      );
    }

    if (config.xFrameOptions) {
      res.setHeader("X-Frame-Options", config.xFrameOptions);
    }

    if (config.xContentTypeOptions) {
      res.setHeader("X-Content-Type-Options", config.xContentTypeOptions);
    }

    if (config.referrerPolicy) {
      res.setHeader("Referrer-Policy", config.referrerPolicy);
    }

    if (config.permissionsPolicy) {
      res.setHeader("Permissions-Policy", config.permissionsPolicy);
    }

    // Additional security headers
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    res.removeHeader("X-Powered-By");

    next();
  };
}

/**
 * Combined security middleware (CORS + headers)
 */
export function createSecurityMiddleware(
  corsConfig?: CorsConfig,
  headersConfig?: SecurityHeadersConfig,
) {
  const cors = corsConfig
    ? corsMiddleware(corsConfig)
    : corsMiddleware(productionCorsConfig);

  const headers = headersConfig
    ? securityHeadersMiddleware(headersConfig)
    : securityHeadersMiddleware(productionSecurityHeaders);

  return (req: any, res: any, next: () => void): void => {
    cors(req, res, () => {
      headers(req, res, next);
    });
  };
}

/**
 * Validate security configuration
 */
export function validateSecurityConfig(
  corsConfig: CorsConfig,
  headersConfig: SecurityHeadersConfig,
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  // Check for wildcard origins in production
  if (
    process.env.NODE_ENV === "production" &&
    corsConfig.allowedOrigins.includes("*")
  ) {
    warnings.push(
      "SECURITY WARNING: Wildcard CORS origin (*) should not be used in production",
    );
  }

  // Check for missing HSTS in production
  if (
    process.env.NODE_ENV === "production" &&
    !headersConfig.strictTransportSecurity
  ) {
    warnings.push(
      "SECURITY WARNING: HSTS (Strict-Transport-Security) not configured",
    );
  }

  // Check for weak CSP
  if (
    headersConfig.contentSecurityPolicy &&
    (headersConfig.contentSecurityPolicy.includes("'unsafe-inline'") ||
      headersConfig.contentSecurityPolicy.includes("'unsafe-eval'"))
  ) {
    warnings.push(
      "SECURITY WARNING: CSP contains 'unsafe-inline' or 'unsafe-eval' which weakens XSS protection",
    );
  }

  // Log warnings
  if (warnings.length > 0) {
    for (const warning of warnings) {
      log.warn(warning);
    }
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}
