import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const projectRoot = join(__dirname, '..', '..');

const runCli = (args: string[], env: Record<string, string> = {}) => {
  const output = execFileSync('node', ['dist/cli/index.js', ...args], {
    cwd: projectRoot,
    env: {
      ...process.env,
      CODEX_DEBUG: '0',
      CODEX_CONFIG_SKIP_DISK_IO: '1',
      ...env
    },
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 20000
  });
  return output;
};

describe('Codex-Synaptic CLI commands', () => {
  beforeAll(() => {
    execFileSync('npm', ['run', 'build'], {
      cwd: projectRoot,
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: 'pipe'
    });
  });

  it('reports when the system has not been started', () => {
    const output = runCli(['system', 'status']);
    expect(output).toContain('System not started');
  });

  it('shows empty recent task history by default', () => {
    const output = runCli(['task', 'recent']);
    expect(output).toContain('No tasks executed yet in this session');
  });

  it('previews Codex context during hive-mind dry-run enrichment', () => {
    const output = runCli(['hive-mind', 'spawn', 'Smoke test prompt', '--codex', '--dry-run']);
    expect(output).toContain('Codex context summary');
    expect(output).toContain('Dry-run: Codex context ready');
  });

  it('invokes codex relay via passthrough mock', () => {
    const output = runCli(
      ['--codex', 'relay', 'Mock passthrough run', '--dry-run'],
      { CODEX_PASSTHROUGH_MOCK: '1' }
    );
    expect(output).toContain('Codex CLI Passthrough Mode Activated');
    expect(output).toContain('Mock Codex passthrough enabled (tests only)');
  });

  it('requires Codex context when using hive-mind dry-run guardrails', () => {
    try {
      runCli(['hive-mind', 'spawn', 'Dry-run guardrail check', '--dry-run']);
      throw new Error('Expected hive-mind dry-run to exit with guidance when Codex context is missing');
    } catch (error: any) {
      if (typeof error?.status !== 'number') {
        throw error;
      }
      expect(error.status).toBe(1);
      const stderr = String(error.stderr ?? '');
      expect(stderr).toContain('--dry-run can only be used together with --codex');
    }
  });
});
