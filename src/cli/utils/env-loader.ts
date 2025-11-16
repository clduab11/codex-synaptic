/**
 * Environment variable loading and management utilities
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

/**
 * Loads environment variables from a .env file
 * @param filePath - Path to the .env file
 * @returns true if any variables were loaded, false otherwise
 */
export function loadEnvFile(filePath: string): boolean {
  if (!existsSync(filePath)) {
    return false;
  }

  try {
    const content = readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    let applied = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }

      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      if (!key) {
        continue;
      }

      let value = line.slice(separatorIndex + 1).trim();
      if (!value) {
        value = "";
      }

      const startsWithQuote = value.startsWith('"') || value.startsWith("'");
      const endsWithQuote = value.endsWith('"') || value.endsWith("'");
      if (startsWithQuote && endsWithQuote && value.length >= 2) {
        value = value.slice(1, -1);
      }

      value = value
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t");

      if (process.env[key] === undefined) {
        process.env[key] = value;
        applied = true;
      }
    }

    return applied;
  } catch {
    return false;
  }
}

/**
 * Bootstraps CLI environment by loading .env files from various locations
 * @returns Array of source paths that were successfully loaded
 */
export function bootstrapCliEnv(): string[] {
  const sources: string[] = [];
  const cwd = process.cwd();
  const candidates = [
    resolve(cwd, ".env"),
    resolve(cwd, ".env.local"),
    resolve(cwd, "src/cli/.env"),
  ];

  for (const candidate of candidates) {
    if (loadEnvFile(candidate)) {
      sources.push(candidate);
    }
  }

  return sources;
}

/**
 * Bootstraps environment for CLI with system defaults
 */
export function bootstrapEnvForCli(): void {
  // Load .env files if present
  bootstrapCliEnv();

  // Suppress experimental warnings unless explicitly enabled
  if (!process.env.NODE_OPTIONS?.includes("--no-warnings")) {
    process.env.NODE_NO_WARNINGS = "1";
  }

  // Set default NODE_ENV if not specified
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = "development";
  }
}
