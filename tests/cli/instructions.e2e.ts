import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const projectRoot = resolve(__dirname, '..', '..');

const runCli = (args: string[]) =>
  execFileSync('node', ['dist/cli/index.js', ...args], {
    cwd: projectRoot,
    env: { ...process.env, CODEX_DEBUG: '0' },
    encoding: 'utf8'
  });

describe('CLI instructions sync parity', () => {
  let tempRoot: string | undefined;

  beforeAll(() => {
    execFileSync('npm', ['run', 'build'], {
      cwd: projectRoot,
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: 'pipe'
    });
  });

  afterEach(() => {
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
  });

  it('produces machine-readable JSON when requested', () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'codex-instructions-e2e-'));
    writeFileSync(
      join(tempRoot, 'AGENTS.md'),
      '# Test Instructions\n\n- Must follow E2E parity flows\n- Ensure JSON output is emitted\n',
      'utf8'
    );

    const output = runCli([
      'instructions',
      'sync',
      '--root',
      tempRoot,
      '--no-cache',
      '--json'
    ]);

    const payload = JSON.parse(output);

    expect(payload).toHaveProperty('metadataCount', 1);
    expect(typeof payload.contextHash).toBe('string');
    expect(payload.contextHash.length).toBeGreaterThan(0);
    expect(payload.precedenceChain).toEqual(['.:GLOBAL']);
    expect(payload.cacheUsed).toBe(false);
    expect(typeof payload.durationMs).toBe('number');
  });
});
