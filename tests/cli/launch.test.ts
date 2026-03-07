import { describe, expect, it, vi } from 'vitest';
import {
  LaunchNextAction,
  runLaunch,
  buildLaunchStrictJsonReport,
  type LaunchDependencies,
  type LaunchReport
} from '../../src/cli/launch';
import type { DoctorReport } from '../../src/cli/doctor';
import { Logger } from '../../src/core/logger';

const passingDoctorReport: DoctorReport = {
  ok: true,
  summary: { passed: 0, failed: 0, total: 0 },
  checks: []
};

describe('runLaunch', () => {
  it('returns ready=true when all launch gates pass', async () => {
    const ensuredProfiles: string[] = [];
    const spawnCalls: string[] = [];

    const deps: LaunchDependencies = {
      fileExists: () => true,
      spawnCommand: async (command, args) => {
        spawnCalls.push(`${command} ${args.join(' ')}`);

        if (command === 'node' && args.includes('--help')) {
          return { status: 0, stdout: 'ok', stderr: '' };
        }

        if (command === 'codex' && args.join(' ') === 'login status') {
          return { status: 0, stdout: 'Logged in as test-user', stderr: '' };
        }

        if (command === 'codex' && args[0] === 'mcp' && args[1] === 'remove') {
          return { status: 0, stdout: '', stderr: '' };
        }

        if (command === 'codex' && args[0] === 'mcp' && args[1] === 'add') {
          return { status: 0, stdout: '', stderr: '' };
        }

        throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
      },
      getBackgroundStatus: () => ({ running: false }),
      startBackground: async () => ({ running: true, pid: 43210 }),
      ensureService: async (name) => {
        ensuredProfiles.push(name);
      },
      getCodexRegistration: (name) => {
        if (name === 'mcp-filesystem') {
          return { codexName: 'filesystem-local', url: 'http://localhost:7040' };
        }
        if (name === 'mcp-playwright') {
          return { codexName: 'playwright-local', url: 'http://localhost:7030' };
        }
        return null;
      },
      runDoctor: async () => passingDoctorReport
    };

    const report = await runLaunch(
      {
        cwd: '/tmp/codex-synaptic',
        strict: true,
        mcpProfiles: ['mcp-filesystem', 'mcp-playwright']
      },
      deps
    );

    expect(report.ok).toBe(true);
    expect(report.nextAction).toBe(LaunchNextAction.Continue);
    expect(report.steps.map((step) => step.id)).toEqual([
      'repo.preflight',
      'codex.auth',
      'runtime.daemon',
      'mcp.up',
      'mcp.codex_register',
      'doctor.strict'
    ]);
    expect(ensuredProfiles).toEqual(['mcp-filesystem', 'mcp-playwright']);
    expect(spawnCalls).toContain('codex mcp add filesystem-local --url http://localhost:7040');
    expect(spawnCalls).toContain('codex mcp add playwright-local --url http://localhost:7030');
  });

  it('fail-fast stops immediately on the first failing gate in strict mode', async () => {
    let doctorCalled = false;

    const report = await runLaunch(
      {
        cwd: '/tmp/codex-synaptic',
        strict: true,
        mcpProfiles: ['mcp-filesystem']
      },
      {
        fileExists: () => false,
        runDoctor: async () => {
          doctorCalled = true;
          return passingDoctorReport;
        }
      }
    );

    expect(report.ok).toBe(false);
    expect(report.nextAction).toBe(LaunchNextAction.Stop);
    expect(report.steps).toHaveLength(1);
    expect(report.steps[0].id).toBe('repo.preflight');
    expect(report.doctor.summary.total).toBe(0);
    expect(doctorCalled).toBe(false);
  });

  it('returns remediation commands when MCP startup fails', async () => {
    const report = await runLaunch(
      {
        cwd: '/tmp/codex-synaptic',
        strict: true,
        skipCodexAuth: true,
        mcpProfiles: ['mcp-filesystem']
      },
      {
        fileExists: () => true,
        spawnCommand: async (command, args) => {
          if (command === 'node' && args.includes('--help')) {
            return { status: 0, stdout: 'ok', stderr: '' };
          }
          throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
        },
        getBackgroundStatus: () => ({ running: true, pid: 999 }),
        registriesForProfiles: () => ['ghcr.io'],
        ensureService: async () => {
          throw new Error('docker compose timeout');
        },
        runDoctor: async () => passingDoctorReport
      }
    );

    expect(report.ok).toBe(false);
    expect(report.nextAction).toBe(LaunchNextAction.Stop);
    const mcpStep = report.steps.find((step) => step.id === 'mcp.up');
    expect(mcpStep?.ok).toBe(false);
    expect(mcpStep?.details).toContain('mcp-filesystem');
    expect(mcpStep?.details).toContain('after starting 0/1');
    expect(mcpStep?.remediation).toContain('codex-synaptic env docker-login mcp-filesystem');
    expect(mcpStep?.remediation).toContain('codex-synaptic env up mcp-filesystem');
    expect(mcpStep?.remediation).toContain('codex-synaptic env codex-register mcp-filesystem --replace');
    expect(mcpStep?.remediation).toContain('codex-synaptic env status mcp-filesystem');
    expect((mcpStep?.metadata as { failedProfile?: string } | undefined)?.failedProfile).toBe('mcp-filesystem');
  });

  it('captures MCP bridge error classification when codex registration add fails', async () => {
    let doctorCalled = false;
    const report = await runLaunch(
      {
        cwd: '/tmp/codex-synaptic',
        strict: true,
        skipCodexAuth: true,
        mcpProfiles: ['mcp-filesystem']
      },
      {
        fileExists: () => true,
        spawnCommand: async (command, args) => {
          if (command === 'node' && args.includes('--help')) {
            return { status: 0, stdout: 'ok', stderr: '' };
          }
          if (command === 'codex' && args[0] === 'mcp' && args[1] === 'remove') {
            return { status: 0, stdout: '', stderr: '' };
          }
          if (command === 'codex' && args[0] === 'mcp' && args[1] === 'add') {
            return { status: 1, stdout: 'denied', stderr: 'permission denied' };
          }
          throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
        },
        getBackgroundStatus: () => ({ running: true, pid: 999 }),
        ensureService: async () => {},
        getCodexRegistration: () => ({ codexName: 'filesystem-local', url: 'http://localhost:7040' }),
        runDoctor: async () => {
          doctorCalled = true;
          return passingDoctorReport;
        }
      }
    );

    expect(report.ok).toBe(false);
    expect(report.nextAction).toBe(LaunchNextAction.Stop);
    expect(doctorCalled).toBe(false);
    const registrationStep = report.steps.find((step) => step.id === 'mcp.codex_register');
    expect(registrationStep?.ok).toBe(false);
    expect(registrationStep?.details).toContain('codex mcp add failed for filesystem-local');
    expect(registrationStep?.remediation).toContain('codex-synaptic env codex-register mcp-filesystem --replace');
    expect((registrationStep?.metadata as { code?: string } | undefined)?.code).toBe('MCP_ERROR');
  });

  it('suppresses info-level console logs during MCP startup when configured', async () => {
    const logger = Logger.getInstance();
    const previousConsoleLevel = logger.getConsoleLevel();
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    try {
      const report = await runLaunch(
        {
          cwd: '/tmp/codex-synaptic',
          strict: true,
          skipCodexAuth: true,
          mcpProfiles: ['mcp-filesystem'],
          suppressInfoConsoleLogs: true
        },
        {
          fileExists: () => true,
          spawnCommand: async (command, args) => {
            if (command === 'node' && args.includes('--help')) {
              return { status: 0, stdout: 'ok', stderr: '' };
            }
            if (command === 'codex' && args[0] === 'mcp' && args[1] === 'remove') {
              return { status: 0, stdout: '', stderr: '' };
            }
            if (command === 'codex' && args[0] === 'mcp' && args[1] === 'add') {
              return { status: 0, stdout: '', stderr: '' };
            }
            throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
          },
          getBackgroundStatus: () => ({ running: true, pid: 999 }),
          ensureService: async (name) => {
            logger.info('env', `Starting service ${name}`, { command: 'docker compose up -d' });
          },
          getCodexRegistration: () => ({ codexName: 'filesystem-local', url: 'http://localhost:7040' }),
          runDoctor: async () => passingDoctorReport
        }
      );

      expect(report.ok).toBe(true);
      expect(infoSpy).not.toHaveBeenCalled();
      expect(logger.getConsoleLevel()).toBe(previousConsoleLevel);
    } finally {
      infoSpy.mockRestore();
      logger.setConsoleLevel(previousConsoleLevel);
    }
  });
});

describe('buildLaunchStrictJsonReport', () => {
  const passingReport: LaunchReport = {
    ok: true,
    steps: [
      { id: 'repo.preflight', ok: true, details: 'CLI executable check passed.' },
      { id: 'codex.auth', ok: true, details: 'Logged in.' },
      { id: 'runtime.daemon', ok: true, details: 'Daemon running (pid 123).' },
      { id: 'mcp.codex_register', ok: true, details: 'Registered.' },
      { id: 'doctor.strict', ok: true, details: 'Doctor passed.' }
    ],
    doctor: { ok: true, summary: { passed: 5, failed: 0, total: 5 }, checks: [] },
    nextAction: LaunchNextAction.Continue
  };

  const noop = async () => ({ status: 0, stdout: 'ok', stderr: '' });

  it('includes a check entry for every failing step in report.steps', async () => {
    const failingReport: LaunchReport = {
      ok: false,
      steps: [
        {
          id: 'repo.preflight',
          ok: false,
          details: 'Missing dist/cli/index.js',
          remediation: 'Run `npm run build`.'
        },
        {
          id: 'codex.auth',
          ok: false,
          details: 'Not logged in.',
          remediation: 'Run `codex login` then re-run `codex login status`.'
        },
        {
          id: 'mcp.up',
          ok: false,
          details: 'Failed to start MCP profile mcp-filesystem',
          remediation: 'codex-synaptic env docker-login mcp-filesystem && codex-synaptic env up mcp-filesystem'
        },
        {
          id: 'doctor.strict',
          ok: false,
          details: 'Doctor check failed.',
          remediation: undefined
        }
      ],
      doctor: { ok: false, summary: { passed: 0, failed: 4, total: 4 }, checks: [] },
      nextAction: LaunchNextAction.Stop
    };

    const result = await buildLaunchStrictJsonReport(failingReport, { cwd: '/tmp/test' }, { spawnCommand: noop });

    const checkNames = result.checks.map((c) => c.name);
    expect(checkNames).toContain('repo.preflight');
    expect(checkNames).toContain('codex.auth');
    expect(checkNames).toContain('mcp.up');
    expect(checkNames).toContain('doctor.strict');

    const preflightCheck = result.checks.find((c) => c.name === 'repo.preflight');
    expect(preflightCheck?.status).toBe('fail');
    expect(preflightCheck?.detail).toContain('npm run build');

    const doctorCheck = result.checks.find((c) => c.name === 'doctor.strict');
    expect(doctorCheck?.status).toBe('fail');
  });

  it('emits fixes for failing steps that have remediations and skips those without', async () => {
    const failingReport: LaunchReport = {
      ok: false,
      steps: [
        {
          id: 'repo.preflight',
          ok: false,
          details: 'Missing dist/cli/index.js',
          remediation: 'Run `npm run build`.'
        },
        {
          id: 'doctor.strict',
          ok: false,
          details: 'Doctor check failed.',
          remediation: undefined
        }
      ],
      doctor: { ok: false, summary: { passed: 0, failed: 2, total: 2 }, checks: [] },
      nextAction: LaunchNextAction.Stop
    };

    const result = await buildLaunchStrictJsonReport(failingReport, { cwd: '/tmp/test' }, { spawnCommand: noop });

    const fixCommands = result.fixes.map((f) => f.command);
    expect(fixCommands.some((cmd) => cmd.includes('npm run build'))).toBe(true);
    // doctor.strict has no remediation; no fix should be emitted for it
    expect(fixCommands.some((cmd) => cmd.toLowerCase().includes('doctor'))).toBe(false);
  });

  it('reports ok=true and includes no fail checks when all steps pass and runtime checks pass', async () => {
    const result = await buildLaunchStrictJsonReport(passingReport, { cwd: '/tmp/test' }, { spawnCommand: noop });

    const stepOnlyCheckNames = ['repo.preflight', 'codex.auth', 'mcp.up', 'doctor.strict'];
    const stepCheckNames = result.checks.map((c) => c.name);
    // Passing steps are never pushed into checks by the step-loop
    expect(stepCheckNames.every((name) => !stepOnlyCheckNames.includes(name))).toBe(true);
    expect(result.capabilities).toContain('launch-gate');
    expect(result.nextActions[0]).toContain('Launch gate passed');
  });
});
