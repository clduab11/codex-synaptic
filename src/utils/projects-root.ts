import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ENV_OVERRIDE = 'CODEX_PROJECTS_ROOT';
const FALLBACK_DIRECTORIES = ['user-projects', 'codex-projects'];

/**
 * Resolve the absolute path for the directory where Codex-Synaptic stores generated projects.
 *
 * Preference order:
 *   1. Explicit override via CODEX_PROJECTS_ROOT
 *   2. `user-projects` directory if present
 *   3. Legacy `codex-projects` directory (for backward compatibility)
 *   4. Default to `user-projects` under the current working directory
 */
export function resolveProjectsRoot(): string {
  const override = process.env[ENV_OVERRIDE];
  if (override && override.trim().length) {
    return resolve(process.cwd(), override.trim());
  }

  for (const candidate of FALLBACK_DIRECTORIES) {
    const candidatePath = resolve(process.cwd(), candidate);
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  // Final fallback if neither directory exists yet
  return resolve(process.cwd(), FALLBACK_DIRECTORIES[0]);
}

export function describeProjectsRoot(): string {
  const override = process.env[ENV_OVERRIDE];
  if (override && override.trim().length) {
    return override.trim();
  }
  return FALLBACK_DIRECTORIES[0];
}