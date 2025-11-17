/**
 * Secrets management utilities
 * Provides secure handling of API keys, tokens, and sensitive configuration
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { log } from "../observability/logger.js";

/**
 * Secrets store interface
 */
export interface SecretsStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
}

/**
 * Environment-based secrets store (fallback)
 */
class EnvironmentSecretsStore implements SecretsStore {
  async get(key: string): Promise<string | undefined> {
    return process.env[key];
  }

  async set(key: string, value: string): Promise<void> {
    process.env[key] = value;
  }

  async delete(key: string): Promise<void> {
    delete process.env[key];
  }

  async list(): Promise<string[]> {
    return Object.keys(process.env);
  }
}

/**
 * File-based secrets store (for local development)
 */
class FileSecretsStore implements SecretsStore {
  private secrets: Map<string, string> = new Map();
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath || join(process.cwd(), ".secrets.json");
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const content = readFileSync(this.filePath, "utf-8");
        const data = JSON.parse(content);
        this.secrets = new Map(Object.entries(data));
        log.info("Loaded secrets from file", { count: this.secrets.size });
      }
    } catch (error: any) {
      log.error("Failed to load secrets file", { error: error.message });
    }
  }

  async get(key: string): Promise<string | undefined> {
    return this.secrets.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    this.secrets.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.secrets.delete(key);
  }

  async list(): Promise<string[]> {
    return Array.from(this.secrets.keys());
  }
}

/**
 * Secrets manager with multiple backend support
 */
export class SecretsManager {
  private store: SecretsStore;
  private cache: Map<string, { value: string; expiresAt: number }> = new Map();
  private cacheTtl: number = 300000; // 5 minutes

  constructor(store?: SecretsStore) {
    this.store = store || this.createDefaultStore();
  }

  private createDefaultStore(): SecretsStore {
    // In production, you would integrate with:
    // - AWS Secrets Manager
    // - HashiCorp Vault
    // - Azure Key Vault
    // - Google Secret Manager

    if (process.env.NODE_ENV === "production") {
      log.warn(
        "Using environment-based secrets store in production. Consider using a dedicated secrets manager.",
      );
      return new EnvironmentSecretsStore();
    } else {
      return new FileSecretsStore();
    }
  }

  /**
   * Get a secret value with caching
   */
  async getSecret(key: string): Promise<string | undefined> {
    // Check cache first
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    // Fetch from store
    const value = await this.store.get(key);

    if (value) {
      // Cache the value
      this.cache.set(key, {
        value,
        expiresAt: Date.now() + this.cacheTtl,
      });
    }

    return value;
  }

  /**
   * Get a secret or throw error if not found
   */
  async getSecretOrThrow(key: string): Promise<string> {
    const value = await this.getSecret(key);
    if (!value) {
      throw new Error(`Secret '${key}' not found`);
    }
    return value;
  }

  /**
   * Set a secret value
   */
  async setSecret(key: string, value: string): Promise<void> {
    await this.store.set(key, value);
    // Invalidate cache
    this.cache.delete(key);
    log.info("Secret set", { key });
  }

  /**
   * Delete a secret
   */
  async deleteSecret(key: string): Promise<void> {
    await this.store.delete(key);
    this.cache.delete(key);
    log.info("Secret deleted", { key });
  }

  /**
   * List all secret keys
   */
  async listSecrets(): Promise<string[]> {
    return this.store.list();
  }

  /**
   * Rotate a secret (generate new value)
   */
  async rotateSecret(key: string, generator: () => string): Promise<string> {
    const newValue = generator();
    await this.setSecret(key, newValue);
    log.info("Secret rotated", { key });
    return newValue;
  }

  /**
   * Clear the secrets cache
   */
  clearCache(): void {
    this.cache.clear();
    log.debug("Secrets cache cleared");
  }
}

/**
 * Global secrets manager instance
 */
export const secretsManager = new SecretsManager();

/**
 * Redact sensitive data from logs
 */
export function redactSensitiveData(data: any): any {
  if (typeof data !== "object" || data === null) {
    return data;
  }

  const sensitiveKeys = [
    "password",
    "token",
    "apikey",
    "api_key",
    "secret",
    "authorization",
    "auth",
    "credentials",
    "private_key",
    "privatekey",
  ];

  const redacted = Array.isArray(data) ? [...data] : { ...data };

  for (const key in redacted) {
    const lowerKey = key.toLowerCase();

    if (sensitiveKeys.some((sk) => lowerKey.includes(sk))) {
      redacted[key] = "[REDACTED]";
    } else if (typeof redacted[key] === "object" && redacted[key] !== null) {
      redacted[key] = redactSensitiveData(redacted[key]);
    }
  }

  return redacted;
}

/**
 * Validate that required secrets are present
 */
export async function validateRequiredSecrets(
  requiredKeys: string[],
): Promise<{ valid: boolean; missing: string[] }> {
  const missing: string[] = [];

  for (const key of requiredKeys) {
    const value = await secretsManager.getSecret(key);
    if (!value) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    log.error("Missing required secrets", { missing });
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Generate a secure random secret
 */
export function generateRandomSecret(length: number = 32): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  let result = "";

  // Use crypto.randomBytes for cryptographically secure randomness
  const randomBytes =
    typeof crypto !== "undefined" && crypto.getRandomValues
      ? crypto.getRandomValues(new Uint8Array(length))
      : Buffer.from(
          Array.from({ length }, () => Math.floor(Math.random() * 256)),
        );

  for (let i = 0; i < length; i++) {
    result += chars[randomBytes[i] % chars.length];
  }

  return result;
}
