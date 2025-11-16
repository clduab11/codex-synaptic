/**
 * Validation utilities for CLI inputs and runtime checks
 */

/**
 * Validates that a value is a valid port number
 * @param port - Port number to validate
 * @returns true if valid, false otherwise
 */
export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * Validates that a string is not empty
 * @param value - String to validate
 * @returns true if not empty, false otherwise
 */
export function isNonEmptyString(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validates that a value is a positive integer
 * @param value - Value to validate
 * @returns true if positive integer, false otherwise
 */
export function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/**
 * Validates email format
 * @param email - Email to validate
 * @returns true if valid email format, false otherwise
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validates that a file path is safe (no directory traversal)
 * @param filePath - File path to validate
 * @returns true if safe, false otherwise
 */
export function isSafeFilePath(filePath: string): boolean {
  // Check for directory traversal attempts
  const dangerous = ["../", "..\\", "../", "..\\\\"];
  return !dangerous.some((pattern) => filePath.includes(pattern));
}

/**
 * Validates JSON string
 * @param jsonString - JSON string to validate
 * @returns true if valid JSON, false otherwise
 */
export function isValidJson(jsonString: string): boolean {
  try {
    JSON.parse(jsonString);
    return true;
  } catch {
    return false;
  }
}
