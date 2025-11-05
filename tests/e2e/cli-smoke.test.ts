import { spawnSync, SpawnSyncReturns } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CLI_ENTRY = join(process.cwd(), 'dist', 'cli', 'index.js');

type CliResult = SpawnSyncReturns<string>;

function runCli(
  args: string[],
  options: { allowFailure?: boolean; env?: Record<string, string> } = {}
): CliResult {
  const { allowFailure = false, env = {} } = options;

  const mergedEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...env
  };

  if (!mergedEnv.CODEX_CONFIG_SKIP_DISK_IO) {
    mergedEnv.CODEX_CONFIG_SKIP_DISK_IO = '1';
  }
  if (!mergedEnv.CODEX_CLI_AUTO_SHUTDOWN) {
    mergedEnv.CODEX_CLI_AUTO_SHUTDOWN = '1';
  }

  const result = spawnSync('node', [CLI_ENTRY, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: mergedEnv,
    maxBuffer: 10 * 1024 * 1024
  });

  if (!allowFailure) {
    if (result.error) {
      throw result.error;
    }

    expect(
      result.status,
      `Expected CLI to exit with code 0 but received ${result.status} for args: ${args.join(' ')}`
    ).toBe(0);
  }

  return result;
}

describe('codex-synaptic CLI smoke suite', () => {
  it('shows top-level help', () => {
    const { stdout } = runCli(['--help']);
    expect(stdout).toContain('Codex-Synaptic CLI');
    expect(stdout).toContain('Distributed agent orchestration');
  });

  it('reports system status when orchestrator is not running', () => {
    const { stdout } = runCli(['system', 'status']);
    expect(stdout).toContain('System not started');
  });

  it('lists registered agents with auto-shutdown lifecycle', () => {
    const { stdout } = runCli(['agent', 'list']);
    expect(stdout).toMatch(/swarm_coordinator/);
    expect(stdout).toMatch(/consensus_coordinator/);
  });

  it('prints neural mesh status', () => {
    const { stdout } = runCli(['mesh', 'status']);
    expect(stdout).toContain('Neural Mesh');
  });

  it('prints swarm status overview', () => {
    const { stdout } = runCli(['swarm', 'status']);
    expect(stdout).toContain('Swarm Coordination');
  });

  it('shows consensus telemetry snapshot', () => {
    const { stdout } = runCli(['consensus', 'telemetry', '--limit', '2']);
    expect(stdout).toMatch(/Consensus Telemetry|No consensus telemetry/i);
  });

  it('supports Codex context previews for hive-mind dry-run', () => {
    const { stdout } = runCli(['hive-mind', 'spawn', 'Repo audit', '--codex', '--dry-run']);
    expect(stdout).toContain('Dry-run: Codex context ready');
    expect(stdout).toContain('Codex context summary');
  });

  it('supports Codex relay passthrough with snapshot exports', () => {
    const { stdout } = runCli(
      ['--codex', 'relay', 'Quick orientation', '--dry-run'],
      { env: { CODEX_PASSTHROUGH_MOCK: '1' } }
    );
    expect(stdout).toContain('Codex CLI Passthrough Mode Activated');
    expect(stdout).toContain('Mock Codex passthrough enabled (tests only)');
  });
});
