/**
 * Helper functions for doctor command
 * Extracted to reduce complexity in main CLI handler
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import chalk from 'chalk';

export interface HealthCheck {
  id: string;
  ok: boolean;
  details: string;
  remediation?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Check if CLI build artifact exists
 */
export function checkCliBuildArtifact(): HealthCheck {
  const distCliPath = join(process.cwd(), 'dist', 'cli', 'index.js');
  const distExists = existsSync(distCliPath);
  
  return {
    id: 'repo.cli_build_artifact',
    ok: distExists,
    details: distExists ? `Found ${distCliPath}` : `Missing ${distCliPath}`,
    remediation: distExists ? undefined : 'Run `npm run build`.'
  };
}

/**
 * Check if CLI can execute
 */
export function checkCliExecution(distCliPath: string): HealthCheck | null {
  if (!existsSync(distCliPath)) {
    return null;
  }

  const cliHelp = spawnSync('node', [distCliPath, '--help'], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  
  return {
    id: 'repo.cli_exec',
    ok: cliHelp.status === 0,
    details: cliHelp.status === 0 
      ? 'CLI help command succeeded.' 
      : (cliHelp.stderr?.trim() || 'CLI help command failed.'),
    remediation: cliHelp.status === 0 
      ? undefined 
      : 'Run `npm run build` and re-run `node dist/cli/index.js --help`.'
  };
}

/**
 * Check Codex authentication status
 */
export function checkCodexAuth(): HealthCheck {
  const loginStatus = spawnSync('codex', ['login', 'status'], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  
  const stdout = loginStatus.stdout?.trim() || '';
  const stderr = loginStatus.stderr?.trim() || '';
  const ok = loginStatus.status === 0 && stdout.toLowerCase().includes('authenticated');
  
  return {
    id: 'codex.auth',
    ok,
    details: ok 
      ? 'Codex is authenticated.' 
      : (stderr || stdout || 'Codex authentication check failed.'),
    remediation: ok ? undefined : 'Run `codex login`.'
  };
}

/**
 * Check MCP profile health
 * Note: This function is not used in the refactored code as the doctor command
 * handles MCP checks directly using serviceManager from env/service-manager.ts
 */
export async function checkMcpProfile(
  profileName: string
): Promise<HealthCheck> {
  try {
    // This function is kept for potential future use but not currently called
    return {
      id: `mcp.${profileName}`,
      ok: false,
      details: `Profile checking not implemented in this helper`,
      remediation: `Use serviceManager.status(${profileName}) directly`
    };
  } catch (error) {
    return {
      id: `mcp.${profileName}`,
      ok: false,
      details: `Error checking profile ${profileName}: ${error instanceof Error ? error.message : String(error)}`,
      remediation: `Verify profile ${profileName} exists and is configured correctly.`
    };
  }
}

/**
 * Render health check results
 */
export function renderHealthCheckResults(
  checks: HealthCheck[],
  options: { json?: boolean; strict?: boolean }
): void {
  const passed = checks.filter((check) => check.ok).length;
  const failed = checks.length - passed;

  if (options.json) {
    console.log(JSON.stringify({
      ok: failed === 0,
      summary: { passed, failed, total: checks.length },
      checks
    }, null, 2));
  } else {
    console.log(chalk.blue('🩺 Codex-Synaptic Doctor'));
    console.log(chalk.gray(`  Passed: ${passed}`));
    console.log(chalk.gray(`  Failed: ${failed}`));

    checks.forEach((check) => {
      const marker = check.ok ? chalk.green('✓') : chalk.red('✗');
      console.log(`${marker} ${check.id}: ${check.details}`);
      if (!check.ok && check.remediation) {
        console.log(chalk.yellow(`  remediation: ${check.remediation}`));
      }
    });
  }

  if (options.strict && failed > 0) {
    throw new Error(`Doctor found ${failed} failing check(s).`);
  }
}
