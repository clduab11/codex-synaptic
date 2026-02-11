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

  const result = spawnSync('node', [CLI_ENTRY, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: mergedEnv,
    maxBuffer: 10 * 1024 * 1024,
    timeout: 20000
  });

  if (!allowFailure) {
    if (result.signal) {
      throw new Error(`CLI command timed out for args: ${args.join(' ')} (signal ${result.signal})`);
    }
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
    runCli(['background', 'stop'], { allowFailure: true });
    const { stdout } = runCli(['system', 'status']);
    expect(stdout).toContain('System not started');
  });

  it('lists registered agents and exits in default one-shot lifecycle', () => {
    const { stdout } = runCli(['agent', 'list'], {
      env: { CODEX_CLI_AUTO_SHUTDOWN: '' }
    });
    expect(stdout).toMatch(/swarm_coordinator/);
    expect(stdout).toMatch(/consensus_coordinator/);
  });

  it('shows running background daemon state from system status', () => {
    runCli(['background', 'stop'], { allowFailure: true });
    try {
      const start = runCli(['background', 'start']);
      expect(start.stdout).toContain('Background system running');
      const background = runCli(['background', 'status']);
      expect(background.stdout).toContain('Background system');

      const status = runCli(['system', 'status']);
      const output = `${status.stdout}\n${status.stderr}`;
      expect(output).toContain('Background daemon is running');
      expect(output).toContain('Background system');
    } finally {
      runCli(['background', 'stop'], { allowFailure: true });
    }
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

  it('emits startup auth warnings for invalid OpenAI credentials without stack trace noise', () => {
    const { status, stderr } = runCli(['openai', 'usage', '--json'], {
      allowFailure: true,
      env: {
        OPENAI_API_KEY: 'sk-proj-invalid-key',
        CODEX_CONFIG_SKIP_DISK_IO: '0',
        CODEX_CLI_SILENT: '0',
        CODEX_DEBUG: '0'
      }
    });

    expect(status).toBe(0);
    expect(stderr).toContain('OpenAI credentials rejected while listing models; responses client disabled for this session.');
    expect(stderr).not.toMatch(/\n\s*at\s+[^\n]+/);
    expect(stderr).not.toMatch(/\bError:\s/);
  });
});
