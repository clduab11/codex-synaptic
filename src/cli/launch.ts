import { spawn } from 'child_process';
import { access } from 'fs/promises';
import { join } from 'path';
import {
  getBackgroundStatus,
  startBackgroundSystem,
  type BackgroundStatus
} from './daemon-manager.js';
import { serviceManager, type EnsureServiceOptions } from '../env/service-manager.js';
import {
  collectDoctorRemediations,
  DEFAULT_MCP_PROFILES,
  type SpawnCommandResult,
  runDoctor,
  type DoctorDependencies,
  type DoctorOptions,
  type DoctorReport
} from './doctor.js';
import { BridgeError, ErrorCode } from '../core/errors.js';
import { Logger, LogLevel } from '../core/logger.js';

export interface LaunchStep {
  id: string;
  ok: boolean;
  details: string;
  remediation?: string;
  metadata?: Record<string, unknown>;
}

export interface LaunchReport {
  ok: boolean;
  steps: LaunchStep[];
  doctor: DoctorReport;
  nextAction: LaunchNextAction;
}

export enum LaunchNextAction {
  Continue = 'continue',
  Stop = 'stop'
}

export interface LaunchOptions {
  cwd?: string;
  strict?: boolean;
  skipCodexAuth?: boolean;
  mcpProfiles?: string[];
  suppressInfoConsoleLogs?: boolean;
}

export interface LaunchDependencies extends DoctorDependencies {
  startBackground?: () => Promise<BackgroundStatus>;
  getBackgroundStatus?: () => BackgroundStatus;
  ensureService?: (name: string, options?: EnsureServiceOptions) => Promise<void>;
  runDoctor?: (options: DoctorOptions, deps?: DoctorDependencies) => Promise<DoctorReport>;
}

const EMPTY_DOCTOR_REPORT: DoctorReport = {
  ok: false,
  summary: {
    passed: 0,
    failed: 0,
    total: 0
  },
  checks: []
};

function normalizeSpawn(
  deps: LaunchDependencies
): (
    command: string,
    args: string[],
    options: { cwd: string; encoding: BufferEncoding }
  ) => Promise<SpawnCommandResult> {
  return deps.spawnCommand
    ?? ((command, args, spawnOptions) => new Promise<SpawnCommandResult>((resolve) => {
      const child = spawn(command, args, {
        cwd: spawnOptions.cwd,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      if (child.stdout) {
        child.stdout.setEncoding(spawnOptions.encoding);
      }
      if (child.stderr) {
        child.stderr.setEncoding(spawnOptions.encoding);
      }

      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr?.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.on('close', (status) => {
        resolve({ status, stdout, stderr });
      });
      child.on('error', (error) => {
        resolve({
          status: 1,
          stdout,
          stderr: stderr || `${error.name}: ${error.message}`
        });
      });
    }));
}

function buildLaunchReport(steps: LaunchStep[], doctorReport: DoctorReport): LaunchReport {
  const ok = steps.every((step) => step.ok) && doctorReport.ok;
  return {
    ok,
    steps,
    doctor: doctorReport,
    nextAction: ok ? LaunchNextAction.Continue : LaunchNextAction.Stop
  };
}

function collectLaunchRemediationsFromStep(step: LaunchStep): string[] {
  if (!step.remediation) {
    return [];
  }

  return step.remediation
    .split('&&')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildMcpBootstrapRemediation(profileNames: string[]): string {
  const commands: string[] = [];

  commands.push(`codex-synaptic env docker-login ${profileNames.join(' ')}`);
  commands.push(`codex-synaptic env up ${profileNames.join(' ')}`);
  commands.push(`codex-synaptic env codex-register ${profileNames.join(' ')} --replace`);

  return commands.join(' && ');
}

async function withSuppressedInfoConsoleLogs<T>(enabled: boolean, work: () => Promise<T>): Promise<T> {
  if (!enabled) {
    return work();
  }

  const logger = Logger.getInstance();
  const previousConsoleLevel = logger.getConsoleLevel();
  if (previousConsoleLevel >= LogLevel.WARN) {
    return work();
  }

  logger.setConsoleLevel(LogLevel.WARN);
  try {
    return await work();
  } finally {
    logger.setConsoleLevel(previousConsoleLevel);
  }
}

export function collectLaunchRemediations(report: LaunchReport): string[] {
  const unique = new Set<string>();

  for (const step of report.steps) {
    if (step.ok) {
      continue;
    }
    const commands = collectLaunchRemediationsFromStep(step);
    for (const command of commands) {
      unique.add(command);
    }
  }

  for (const command of collectDoctorRemediations(report.doctor)) {
    unique.add(command);
  }

  return Array.from(unique);
}

export async function runLaunch(options: LaunchOptions = {}, deps: LaunchDependencies = {}): Promise<LaunchReport> {
  const cwd = options.cwd ?? process.cwd();
  const strict = options.strict !== false;
  const profileNames = options.mcpProfiles?.length
    ? [...options.mcpProfiles]
    : [...DEFAULT_MCP_PROFILES];

  const fileExists = deps.fileExists ?? (async (path: string) => {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  });
  const spawnCommand = normalizeSpawn(deps);
  const startBackground = deps.startBackground ?? (() => startBackgroundSystem());
  const readBackgroundStatus = deps.getBackgroundStatus ?? (() => getBackgroundStatus());
  const ensureService = deps.ensureService
    ?? ((name: string, ensureOptions?: EnsureServiceOptions) => serviceManager.ensureService(name, ensureOptions));
  const executeDoctor = deps.runDoctor ?? runDoctor;

  const steps: LaunchStep[] = [];
  let doctorReport = EMPTY_DOCTOR_REPORT;

  const appendStep = (step: LaunchStep): LaunchReport | null => {
    steps.push(step);
    if (strict && !step.ok) {
      return buildLaunchReport(steps, doctorReport);
    }
    return null;
  };

  const distCliPath = join(cwd, 'dist', 'cli', 'index.js');
  const distExists = await fileExists(distCliPath);

  let preflightStep: LaunchStep;
  if (distExists) {
    const cliHelp = await spawnCommand('node', [distCliPath, '--help'], {
      cwd,
      encoding: 'utf8'
    });
    preflightStep = {
      id: 'repo.preflight',
      ok: cliHelp.status === 0,
      details: cliHelp.status === 0
        ? `Found ${distCliPath}; CLI executable check passed.`
        : `CLI executable check failed: ${cliHelp.stderr?.trim() || 'unknown error'}`,
      remediation: cliHelp.status === 0
        ? undefined
        : 'Run `npm run build` and then `node dist/cli/index.js --help`.'
    };
  } else {
    preflightStep = {
      id: 'repo.preflight',
      ok: false,
      details: `Missing ${distCliPath}`,
      remediation: 'Run `npm run build`.'
    };
  }

  {
    const stop = appendStep(preflightStep);
    if (stop) {
      return stop;
    }
  }

  let codexAuthStep: LaunchStep;
  if (options.skipCodexAuth) {
    codexAuthStep = {
      id: 'codex.auth',
      ok: true,
      details: 'Skipped codex auth check (--skip-codex-auth).'
    };
  } else {
    const loginStatus = await spawnCommand('codex', ['login', 'status'], {
      cwd,
      encoding: 'utf8'
    });
    const stdout = loginStatus.stdout?.trim() || '';
    const ok = loginStatus.status === 0 && !/not logged in/i.test(stdout);
    codexAuthStep = {
      id: 'codex.auth',
      ok,
      details: stdout || loginStatus.stderr?.trim() || 'No output',
      remediation: ok ? undefined : 'Run `codex login` then re-run `codex login status`.'
    };
  }

  {
    const stop = appendStep(codexAuthStep);
    if (stop) {
      return stop;
    }
  }

  let daemonStep: LaunchStep;
  const existingDaemon = readBackgroundStatus();
  if (existingDaemon.running) {
    daemonStep = {
      id: 'runtime.daemon',
      ok: true,
      details: `Background daemon already running (pid ${existingDaemon.pid ?? 'unknown'}).`
    };
  } else {
    try {
      const started = await startBackground();
      daemonStep = {
        id: 'runtime.daemon',
        ok: started.running,
        details: started.running
          ? `Background daemon started (pid ${started.pid ?? 'unknown'}).`
          : 'Background daemon did not report running state.',
        remediation: started.running
          ? undefined
          : 'Run `codex-synaptic background start` and inspect logs with `codex-synaptic background logs --tail 100`.'
      };
    } catch (error) {
      daemonStep = {
        id: 'runtime.daemon',
        ok: false,
        details: `Failed to start background daemon: ${(error as Error).message}`,
        remediation: 'Run `codex-synaptic background start` and inspect logs with `codex-synaptic background logs --tail 100`.'
      };
    }
  }

  {
    const stop = appendStep(daemonStep);
    if (stop) {
      return stop;
    }
  }

  let mcpUpStep: LaunchStep;
  if (!profileNames.length) {
    mcpUpStep = {
      id: 'mcp.up',
      ok: true,
      details: 'No MCP profiles requested for launch gating.'
    };
  } else {
    const startedProfiles: string[] = [];
    let failedProfile: string | null = null;
    let startupError: Error | null = null;

    for (const profileName of profileNames) {
      try {
        await withSuppressedInfoConsoleLogs(Boolean(options.suppressInfoConsoleLogs), async () => (
          ensureService(profileName, { waitForHealth: true })
        ));
        startedProfiles.push(profileName);
      } catch (error) {
        failedProfile = profileName;
        startupError = error as Error;
        break;
      }
    }

    if (!startupError) {
      mcpUpStep = {
        id: 'mcp.up',
        ok: true,
        details: `Started ${profileNames.length} MCP profile(s): ${profileNames.join(', ')}`
      };
    } else {
      const targetedProfiles = failedProfile ? [failedProfile] : profileNames;
      const remediationParts = [
        buildMcpBootstrapRemediation(targetedProfiles),
        `codex-synaptic env status ${targetedProfiles.join(' ')}`
      ];

      mcpUpStep = {
        id: 'mcp.up',
        ok: false,
        details: `Failed to start MCP profile ${failedProfile ?? 'unknown'} after starting ${startedProfiles.length}/${profileNames.length}: ${startupError.message}`,
        remediation: remediationParts.join(' && '),
        metadata: {
          failedProfile: failedProfile ?? undefined,
          startedProfiles
        }
      };
    }
  }

  {
    const stop = appendStep(mcpUpStep);
    if (stop) {
      return stop;
    }
  }

  let codexRegisterStep: LaunchStep;
  if (!profileNames.length) {
    codexRegisterStep = {
      id: 'mcp.codex_register',
      ok: true,
      details: 'No MCP profiles requested for Codex registration.'
    };
  } else {
    try {
      const registeredNames: string[] = [];
      for (const profileName of profileNames) {
        const registration = (deps.getCodexRegistration ?? serviceManager.codexRegistration.bind(serviceManager))(profileName);
        if (!registration) {
          continue;
        }

        const remove = await spawnCommand('codex', ['mcp', 'remove', registration.codexName], {
          cwd,
          encoding: 'utf8'
        });

        if (remove.status !== 0 && process.env.CODEX_DEBUG === '1') {
          const removeMessage = remove.stderr?.trim() || remove.stdout?.trim() || 'unknown remove failure';
          process.stderr.write(
            `[launch] codex mcp remove ${registration.codexName} returned non-zero: ${removeMessage}\n`
          );
        }

        const add = await spawnCommand('codex', ['mcp', 'add', registration.codexName, '--url', registration.url], {
          cwd,
          encoding: 'utf8'
        });

        if (add.status !== 0) {
          const stderr = add.stderr?.trim() || '';
          if (/already exists/i.test(stderr)) {
            registeredNames.push(registration.codexName);
            continue;
          }

          throw new BridgeError(
            ErrorCode.MCP_ERROR,
            `codex mcp add failed for ${registration.codexName}: ${stderr || add.stdout?.trim() || 'unknown error'}`,
            {
              registration: registration.codexName,
              stderr,
              stdout: add.stdout
            }
          );
        }

        registeredNames.push(registration.codexName);
      }

      codexRegisterStep = {
        id: 'mcp.codex_register',
        ok: true,
        details: registeredNames.length
          ? `Ensured Codex MCP registration for ${registeredNames.join(', ')}`
          : 'Selected MCP profiles do not expose Codex registration metadata.'
      };
    } catch (error) {
      const bridgeError = error instanceof BridgeError ? error : null;
      codexRegisterStep = {
        id: 'mcp.codex_register',
        ok: false,
        details: `Failed to register MCP profile(s) with Codex: ${(error as Error).message}`,
        remediation: `codex-synaptic env codex-register ${profileNames.join(' ')} --replace`,
        metadata: bridgeError
          ? {
            code: bridgeError.code,
            context: bridgeError.context
          }
          : undefined
      };
    }
  }

  {
    const stop = appendStep(codexRegisterStep);
    if (stop) {
      return stop;
    }
  }

  doctorReport = await executeDoctor(
    {
      cwd,
      mcpProfiles: profileNames,
      skipCodexAuth: Boolean(options.skipCodexAuth)
    },
    {
      fileExists,
      spawnCommand,
      getServiceStatus: deps.getServiceStatus,
      getCodexRegistration: deps.getCodexRegistration,
      registriesForProfiles: deps.registriesForProfiles
    }
  );

  const doctorRemediations = collectDoctorRemediations(doctorReport);
  const doctorStep: LaunchStep = {
    id: 'doctor.strict',
    ok: doctorReport.ok,
    details: doctorReport.ok
      ? `Doctor passed (${doctorReport.summary.passed}/${doctorReport.summary.total}).`
      : `Doctor reported ${doctorReport.summary.failed} failing check(s).`,
    remediation: doctorRemediations.length ? doctorRemediations.join(' && ') : undefined
  };

  {
    const stop = appendStep(doctorStep);
    if (stop) {
      return stop;
    }
  }

  return buildLaunchReport(steps, doctorReport);
}
