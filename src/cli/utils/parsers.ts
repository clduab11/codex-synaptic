/**
 * Parsing utilities for CLI input
 */

import { AgentType } from "../../core/types.js";

/**
 * Parses an integer from a string with validation
 * @param value - String value to parse
 * @param label - Label for error messages
 * @returns Parsed integer
 * @throws Error if value is not a valid integer
 */
export function parseInteger(value: string, label: string): number {
  const parsed = parseInt(value, 10);

  if (isNaN(parsed)) {
    throw new Error(`${label} must be a valid integer, got: ${value}`);
  }

  return parsed;
}

/**
 * Parses an agent type from a string
 * @param value - String value to parse
 * @returns AgentType or undefined if invalid
 */
export function parseAgentType(value?: string): AgentType | undefined {
  if (!value) {
    return undefined;
  }

  // Check if it's a valid AgentType
  if (Object.values(AgentType).includes(value as AgentType)) {
    return value as AgentType;
  }

  return undefined;
}

/**
 * Parses a JSON string option
 * @param value - JSON string to parse
 * @returns Parsed object or undefined if invalid
 */
export function parseJsonOption<T = any>(value?: string): T | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

/**
 * Tokenizes CLI arguments respecting quotes
 * @param input - Input string to tokenize
 * @returns Array of tokens
 */
export function tokenizeCliArgs(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const nextChar = input[i + 1];

    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
      continue;
    }

    if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = "";
      continue;
    }

    if (char === " " && !inQuotes) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}
