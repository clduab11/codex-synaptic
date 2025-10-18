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

describe('CLI/API parity workflows', () => {
  let tempDir: string | undefined;

  beforeAll(() => {
    execFileSync('npm', ['run', 'build'], {
      cwd: projectRoot,
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: 'pipe'
    });
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('returns JSON payloads from tool scoring', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'codex-tools-e2e-'));
    const candidatesPath = join(tempDir, 'candidates.json');
    writeFileSync(
      candidatesPath,
      JSON.stringify(
        [
          { id: 'code-generator', description: 'Generates code' },
          { id: 'test-runner', description: 'Runs tests' }
        ],
        null,
        2
      ),
      'utf8'
    );

    const output = runCli([
      'tools',
      'score',
      'Implement swarm telemetry adapters',
      '--candidates',
      candidatesPath,
      '--json'
    ]);

    const payload = JSON.parse(output);

    expect(payload.prompt).toBe('Implement swarm telemetry adapters');
    expect(Array.isArray(payload.scores)).toBe(true);
    expect(payload.scores.length).toBeGreaterThan(0);
    expect(typeof payload.generatedAt).toBe('string');
  });

  it('creates reasoning plans with JSON output', () => {
    const output = runCli([
      'reasoning',
      'plan',
      'Assess CLI to API parity',
      '--type',
      'tot',
      '--json'
    ]);

    const payload = JSON.parse(output);
    expect(payload.plan).toBeDefined();
    expect(payload.plan.status).toBeDefined();
    expect(payload.plan.planId).toMatch(/^plan-/);
    expect(payload.plan.planType).toBe('tot');
  });

  it('evaluates routing recommendations as JSON', () => {
    const output = runCli([
      'router',
      'evaluate',
      'Perform distributed cache warmup',
      '--json'
    ]);

    const payload = JSON.parse(output);
    expect(payload.evaluation).toBeDefined();
    expect(payload.evaluation.agentType).toBeDefined();
    expect(typeof payload.evaluation.confidence).toBe('number');
  });
});
