import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

const projectRoot = resolve(__dirname, '..', '..');

function runCli(args: string[], envOverrides: Record<string, string> = {}) {
  const result = spawnSync('node', ['dist/cli/index.js', ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      CODEX_CLI_AUTO_SHUTDOWN: '1',
      CODEX_CLI_SILENT: '1',
      ...envOverrides,
      CODEX_DEBUG: '0'
    }
  });

  if (result.error) {
    throw result.error;
  }

  return {
    status: result.status ?? 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  };
}

describe('codex-synaptic openai usage', () => {
  const originalApiKey = process.env.OPENAI_API_KEY;

  beforeAll(() => {
    // Ensure CLI build artefacts exist for the tests
    const build = spawnSync('npm', ['run', 'build'], {
      cwd: projectRoot,
      encoding: 'utf8'
    });

    if (build.status !== 0) {
      throw new Error(`npm run build failed: ${build.stderr}`);
    }

    process.env.OPENAI_API_KEY = 'test-token';
  });

  afterAll(() => {
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  });

  it('returns JSON summary when requested', () => {
    const { status, stdout, stderr } = runCli(['openai', 'usage', '--json']);

    expect(status).toBe(0);
    expect(stderr).toBe('');

    const payload = JSON.parse(stdout);
    expect(payload).toHaveProperty('summary');
    expect(payload.summary).toHaveProperty('totals');
    expect(payload.summary).toHaveProperty('throughput');
    expect(typeof payload.windowMinutes).toBe('number');
    expect(payload.summary.totals).toMatchObject({
      requests: expect.any(Number),
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
      totalTokens: expect.any(Number)
    });
  });

  it('rejects non-positive window values', () => {
    const { status, stderr } = runCli(['openai', 'usage', '--window', '0']);

    expect(status).toBe(1);
    expect(stderr).toContain('window must be a positive number');
  });

  it('rejects non-positive limits', () => {
    const { status, stderr } = runCli(['openai', 'usage', '--limit', '0']);

    expect(status).toBe(1);
    expect(stderr).toContain('limit must be a positive integer');
  });
});
