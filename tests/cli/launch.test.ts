import { describe, expect, it, vi } from 'vitest';
import { LaunchNextAction, runLaunch, type LaunchDependencies } from '../../src/cli/launch';
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
