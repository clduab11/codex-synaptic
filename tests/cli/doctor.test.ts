import { describe, expect, it } from 'vitest';
import { runDoctor, type DoctorDependencies } from '../../src/cli/doctor';
import type { ServiceStatus } from '../../src/env/service-manager';

function serviceStatus(overrides: Partial<ServiceStatus> = {}): ServiceStatus {
  return {
    name: 'mcp-filesystem',
    running: true,
    healthy: true,
    raw: 'ok',
    diagnostics: [],
    checkedAt: '2026-02-14T00:00:00.000Z',
    ...overrides
  };
}

describe('runDoctor', () => {
  it('fails when the dist CLI artifact is missing', async () => {
    const deps: DoctorDependencies = {
      fileExists: () => false,
      spawnCommand: (command, args) => {
        if (command === 'codex' && args.join(' ') === 'mcp list --json') {
          return {
            status: 0,
            stdout: '[{"name":"filesystem-local"}]',
            stderr: ''
          };
        }
        throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
      },
      getServiceStatus: async () => serviceStatus(),
      getCodexRegistration: () => ({ codexName: 'filesystem-local', url: 'http://localhost:7040' })
    };

    const report = await runDoctor(
      {
        cwd: '/tmp/codex-synaptic',
        skipCodexAuth: true,
        mcpProfiles: ['mcp-filesystem']
      },
      deps
    );

    expect(report.ok).toBe(false);
    expect(report.summary.failed).toBe(1);
    expect(report.checks.find((check) => check.id === 'repo.cli_build_artifact')?.ok).toBe(false);
  });

  it('fails codex auth check when codex login status returns non-zero', async () => {
    const deps: DoctorDependencies = {
      fileExists: () => true,
      spawnCommand: (command, args) => {
        if (command === 'node' && args.includes('--help')) {
          return { status: 0, stdout: 'ok', stderr: '' };
        }

        if (command === 'codex' && args.join(' ') === 'login status') {
          return { status: 1, stdout: '', stderr: 'Not logged in' };
        }

        if (command === 'codex' && args.join(' ') === 'mcp list --json') {
          return {
            status: 0,
            stdout: '[{"name":"filesystem-local"}]',
            stderr: ''
          };
        }

        throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
      },
      getServiceStatus: async () => serviceStatus(),
      getCodexRegistration: () => ({ codexName: 'filesystem-local', url: 'http://localhost:7040' })
    };

    const report = await runDoctor(
      {
        cwd: '/tmp/codex-synaptic',
        mcpProfiles: ['mcp-filesystem']
      },
      deps
    );

    const authCheck = report.checks.find((check) => check.id === 'codex.auth');
    expect(authCheck?.ok).toBe(false);
    expect(authCheck?.details).toContain('Not logged in');
    expect(authCheck?.remediation).toContain('codex login');
    expect(report.ok).toBe(false);
  });

  it('passes all checks when auth, MCP registration, and services are healthy', async () => {
    const profileRegistrations: Record<string, { codexName: string; url: string }> = {
      'mcp-filesystem': { codexName: 'filesystem-local', url: 'http://localhost:7040' },
      'mcp-playwright': { codexName: 'playwright-local', url: 'http://localhost:7030' }
    };

    const deps: DoctorDependencies = {
      fileExists: () => true,
      spawnCommand: (command, args) => {
        if (command === 'node' && args.includes('--help')) {
          return { status: 0, stdout: 'ok', stderr: '' };
        }

        if (command === 'codex' && args.join(' ') === 'login status') {
          return { status: 0, stdout: 'Logged in as test-user', stderr: '' };
        }

        if (command === 'codex' && args.join(' ') === 'mcp list --json') {
          return {
            status: 0,
            stdout: JSON.stringify([
              { name: 'filesystem-local' },
              { name: 'playwright-local' }
            ]),
            stderr: ''
          };
        }

        throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
      },
      getServiceStatus: async (name) => serviceStatus({ name }),
      getCodexRegistration: (name) => profileRegistrations[name] ?? null
    };

    const report = await runDoctor(
      {
        cwd: '/tmp/codex-synaptic',
        mcpProfiles: ['mcp-filesystem', 'mcp-playwright']
      },
      deps
    );

    expect(report.ok).toBe(true);
    expect(report.summary.failed).toBe(0);
    expect(report.checks.find((check) => check.id === 'repo.cli_exec')?.ok).toBe(true);
    expect(report.checks.find((check) => check.id === 'mcp.mcp-filesystem')?.ok).toBe(true);
    expect(report.checks.find((check) => check.id === 'mcp.mcp-playwright')?.ok).toBe(true);
  });

  it('returns actionable remediation for failing MCP profile checks', async () => {
    const deps: DoctorDependencies = {
      fileExists: () => true,
      spawnCommand: (command, args) => {
        if (command === 'node' && args.includes('--help')) {
          return { status: 0, stdout: 'ok', stderr: '' };
        }

        if (command === 'codex' && args.join(' ') === 'mcp list --json') {
          return {
            status: 0,
            stdout: '[]',
            stderr: ''
          };
        }

        throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
      },
      getServiceStatus: async () => serviceStatus({ running: false, healthy: false }),
      getCodexRegistration: () => ({ codexName: 'filesystem-local', url: 'http://localhost:7040' })
    };

    const report = await runDoctor(
      {
        cwd: '/tmp/codex-synaptic',
        skipCodexAuth: true,
        mcpProfiles: ['mcp-filesystem']
      },
      deps
    );

    const mcpCheck = report.checks.find((check) => check.id === 'mcp.mcp-filesystem');
    expect(mcpCheck?.ok).toBe(false);
    expect(mcpCheck?.remediation).toContain('codex-synaptic env docker-login mcp-filesystem');
    expect(mcpCheck?.remediation).toContain('codex-synaptic env up mcp-filesystem');
    expect(mcpCheck?.remediation).toContain('codex-synaptic env codex-register mcp-filesystem');
  });

  it('fails codex MCP parsing checks when codex mcp list returns malformed JSON', async () => {
    const deps: DoctorDependencies = {
      fileExists: () => true,
      spawnCommand: (command, args) => {
        if (command === 'node' && args.includes('--help')) {
          return { status: 0, stdout: 'ok', stderr: '' };
        }

        if (command === 'codex' && args.join(' ') === 'mcp list --json') {
          return {
            status: 0,
            stdout: 'not-json',
            stderr: ''
          };
        }

        throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
      },
      getServiceStatus: async () => serviceStatus(),
      getCodexRegistration: () => ({ codexName: 'filesystem-local', url: 'http://localhost:7040' })
    };

    const report = await runDoctor(
      {
        cwd: '/tmp/codex-synaptic',
        skipCodexAuth: true,
        mcpProfiles: ['mcp-filesystem']
      },
      deps
    );

    const mcpListCheck = report.checks.find((check) => check.id === 'codex.mcp_list');
    expect(mcpListCheck?.ok).toBe(false);
    expect(mcpListCheck?.remediation).toContain('codex mcp list --json');

    const mcpProfileCheck = report.checks.find((check) => check.id === 'mcp.mcp-filesystem');
    expect(mcpProfileCheck?.ok).toBe(false);
    expect(mcpProfileCheck?.remediation).toContain('codex-synaptic env codex-register mcp-filesystem');
    expect(report.ok).toBe(false);
  });
});
