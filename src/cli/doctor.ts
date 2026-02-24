import { spawn, spawnSync, type SpawnSyncReturns } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { serviceManager, type ServiceStatus } from '../env/service-manager.js';

/**
 * Promisified spawn wrapper that collects stdout/stderr and resolves with status code.
 * Note: This function always resolves (never rejects) to match spawnSync behavior.
 * Errors are communicated via status code and stderr, not via Promise rejection.
 */
function spawnAsync(
  command: string,
  args: string[],
  options: { cwd: string; encoding: BufferEncoding }
): Promise<Pick<SpawnSyncReturns<string>, 'status' | 'stdout' | 'stderr'>> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString(options.encoding);
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString(options.encoding);
    });

    child.on('close', (code) => {
      resolve({
        status: code ?? 0,
        stdout,
        stderr
      });
    });

    child.on('error', (error) => {
      resolve({
        status: 1,
        stdout,
        stderr: stderr || error.message
      });
    });
  });
}

export const DEFAULT_MCP_PROFILES = [
  'mcp-filesystem',
  'mcp-playwright',
  'mcp-desktop-commander'
] as const;

export interface DoctorCheck {
  id: string;
  ok: boolean;
  details: string;
  remediation?: string;
  metadata?: Record<string, unknown>;
}

export interface DoctorSummary {
  passed: number;
  failed: number;
  total: number;
}

export interface DoctorReport {
  ok: boolean;
  summary: DoctorSummary;
  checks: DoctorCheck[];
}

export interface DoctorOptions {
  cwd?: string;
  mcpProfiles?: string[];
  skipCodexAuth?: boolean;
}

export interface DoctorDependencies {
  fileExists?: (path: string) => boolean;
  spawnCommand?: (
    command: string,
    args: string[],
    options: { cwd: string; encoding: BufferEncoding }
  ) => Promise<Pick<SpawnSyncReturns<string>, 'status' | 'stdout' | 'stderr'>>;
  getServiceStatus?: (name: string) => Promise<ServiceStatus>;
  getCodexRegistration?: (name: string) => { codexName: string; url: string } | null;
}

function parseCodexMcpNames(payload: unknown): string[] {
  if (Array.isArray(payload)) {
    return payload
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return undefined;
        }
        return String((entry as { name?: string }).name ?? '');
      })
      .filter(Boolean) as string[];
  }

  if (payload && typeof payload === 'object') {
    const candidateArrays = [
      (payload as { servers?: unknown }).servers,
      (payload as { items?: unknown }).items,
      (payload as { mcpServers?: unknown }).mcpServers
    ];

    for (const candidate of candidateArrays) {
      if (!Array.isArray(candidate)) {
        continue;
      }

      return candidate
        .map((entry) => {
          if (!entry || typeof entry !== 'object') {
            return undefined;
          }
          return String((entry as { name?: string }).name ?? '');
        })
        .filter(Boolean) as string[];
    }
  }

  throw new Error('Unsupported JSON format returned by `codex mcp list --json`.');
}

export function parseProfileList(input: string | string[] | undefined, fallback = [...DEFAULT_MCP_PROFILES]): string[] {
  if (Array.isArray(input)) {
    const normalized = input
      .map((item) => item.trim())
      .filter(Boolean);
    return normalized.length ? normalized : [...fallback];
  }

  if (typeof input === 'string') {
    const normalized = input
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return normalized.length ? normalized : [...fallback];
  }

  return [...fallback];
}

export function collectDoctorRemediations(report: DoctorReport): string[] {
  const unique = new Set<string>();

  for (const check of report.checks) {
    if (check.ok || !check.remediation) {
      continue;
    }

    const commands = check.remediation
      .split('&&')
      .map((item) => item.trim())
      .filter(Boolean);

    for (const command of commands) {
      unique.add(command);
    }
  }

  return Array.from(unique);
}

export async function runDoctor(options: DoctorOptions = {}, deps: DoctorDependencies = {}): Promise<DoctorReport> {
  const cwd = options.cwd ?? process.cwd();
  const profileNames = parseProfileList(options.mcpProfiles);
  const fileExists = deps.fileExists ?? existsSync;
  const spawnCommand = deps.spawnCommand ?? spawnAsync;
  const getServiceStatus = deps.getServiceStatus ?? ((name: string) => serviceManager.status(name));
  const getCodexRegistration = deps.getCodexRegistration
    ?? ((name: string) => serviceManager.codexRegistration(name));

  const checks: DoctorCheck[] = [];

  const distCliPath = join(cwd, 'dist', 'cli', 'index.js');
  const distExists = fileExists(distCliPath);
  checks.push({
    id: 'repo.cli_build_artifact',
    ok: distExists,
    details: distExists ? `Found ${distCliPath}` : `Missing ${distCliPath}`,
    remediation: distExists ? undefined : 'Run `npm run build`.'
  });

  if (distExists) {
    const cliHelp = await spawnCommand('node', [distCliPath, '--help'], {
      cwd,
      encoding: 'utf8'
    });

    checks.push({
      id: 'repo.cli_exec',
      ok: cliHelp.status === 0,
      details: cliHelp.status === 0
        ? 'CLI help command succeeded.'
        : (cliHelp.stderr?.trim() || 'CLI help command failed.'),
      remediation: cliHelp.status === 0
        ? undefined
        : 'Run `npm run build` and re-run `node dist/cli/index.js --help`.'
    });
  }

  if (!options.skipCodexAuth) {
    const loginStatus = await spawnCommand('codex', ['login', 'status'], {
      cwd,
      encoding: 'utf8'
    });

    const stdout = loginStatus.stdout?.trim() || '';
    const ok = loginStatus.status === 0 && !/not logged in/i.test(stdout);

    checks.push({
      id: 'codex.auth',
      ok,
      details: stdout || loginStatus.stderr?.trim() || 'No output',
      remediation: ok ? undefined : 'Run `codex login` then re-run `codex login status`.'
    });
  }

  const codexMcpList = await spawnCommand('codex', ['mcp', 'list', '--json'], {
    cwd,
    encoding: 'utf8'
  });

  let codexMcpNames = new Set<string>();
  if (codexMcpList.status === 0) {
    try {
      const parsed = JSON.parse(codexMcpList.stdout || '[]') as unknown;
      const names = parseCodexMcpNames(parsed);
      codexMcpNames = new Set(names);
      checks.push({
        id: 'codex.mcp_list',
        ok: true,
        details: `Loaded ${codexMcpNames.size} Codex MCP registration(s).`
      });
    } catch (error) {
      checks.push({
        id: 'codex.mcp_list',
        ok: false,
        details: `Failed to parse codex mcp list output: ${(error as Error).message}`,
        remediation: 'Run `codex mcp list --json` and inspect output.'
      });
    }
  } else {
    checks.push({
      id: 'codex.mcp_list',
      ok: false,
      details: codexMcpList.stderr?.trim() || 'codex mcp list failed',
      remediation: 'Verify Codex CLI install and MCP support (`codex mcp --help`).'
    });
  }

  for (const profileName of profileNames) {
    const status = await getServiceStatus(profileName);
    const registration = getCodexRegistration(profileName);
    const registered = registration ? codexMcpNames.has(registration.codexName) : true;
    const healthy = status.healthy !== false;
    const ok = status.running && healthy && registered;

    let details = `running=${status.running} healthy=${status.healthy === null ? 'n/a' : status.healthy} registered=${registered}`;
    if (status.diagnostics.length) {
      details += ` diagnostics=${status.diagnostics.join(' | ')}`;
    }

    const remediationParts: string[] = [];
    if (!status.running || !healthy) {
      remediationParts.push(`codex-synaptic env up ${profileName}`);
    }
    if (registration && !registered) {
      remediationParts.push(`codex-synaptic env codex-register ${profileName}`);
    }

    checks.push({
      id: `mcp.${profileName}`,
      ok,
      details,
      remediation: remediationParts.length ? remediationParts.join(' && ') : undefined,
      metadata: {
        codexName: registration?.codexName,
        url: registration?.url
      }
    });
  }

  const passed = checks.filter((check) => check.ok).length;
  const failed = checks.length - passed;

  return {
    ok: failed === 0,
    summary: {
      passed,
      failed,
      total: checks.length
    },
    checks
  };
}
