/**
 * Formatting utilities for CLI output
 */

/**
 * Formats a byte count into human-readable format
 * @param bytes - Number of bytes
 * @returns Formatted string (e.g., "1.5 MB")
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Formats elapsed duration from timestamp
 * @param startedAt - Start timestamp in milliseconds
 * @returns Formatted duration string
 */
export function formatElapsedDuration(startedAt: number): string {
  const now = Date.now();
  const elapsed = now - startedAt;

  if (elapsed < 1000) {
    return `${elapsed}ms`;
  }

  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes < 60) {
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/**
 * Formats a detail object into a readable string
 * @param details - Object with key-value pairs
 * @returns Formatted string
 */
export function formatDetailEntry(details: Record<string, unknown>): string {
  return Object.entries(details)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(", ");
}

/**
 * Describes a cache path in a user-friendly way
 * @param absPath - Absolute path to cache
 * @returns Description of the cache path
 */
export function describeCachePath(absPath?: string): string {
  if (!absPath) {
    return "No cache configured";
  }

  // Make path relative to home directory if possible
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (homeDir && absPath.startsWith(homeDir)) {
    return `~${absPath.slice(homeDir.length)}`;
  }

  // Make path relative to cwd if possible
  const cwd = process.cwd();
  if (absPath.startsWith(cwd)) {
    return `.${absPath.slice(cwd.length)}`;
  }

  return absPath;
}
