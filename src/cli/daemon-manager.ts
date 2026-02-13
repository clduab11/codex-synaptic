import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { fork } from 'child_process';
import { createConnection } from 'net';
import { randomUUID } from 'crypto';
import type { InterfaceMode, InterfaceTier } from '../core/config.js';

/**
 * Legacy IPC message types for the forked daemon process channel.
 */
export type DaemonIPCMessage =
  | { type: 'setMode'; mode: InterfaceMode }
  | { type: 'getMode' }
  | { type: 'modeChanged'; mode: InterfaceMode; tier: InterfaceTier }
  | { type: 'setTier'; tier: InterfaceTier }
  | { type: 'shutdown' };

export interface DaemonRuntimeSnapshot {
  pid: number;
  startedAt: string;
  updatedAt: string;
  cwd: string;
  interfaceMode: InterfaceMode;
  tier: InterfaceTier;
  status: {
    initialized: boolean;
    shuttingDown: boolean;
    daemon: boolean;
  };
  telemetry: {
    agents: {
      total: number;
      available: number;
      byType: Record<string, number>;
      byStatus: Record<string, number>;
    };
    resources?: any;
    mesh?: any;
    swarm?: any;
    consensus?: any;
    recentTasks: Array<{
      id: string;
      status: 'completed' | 'failed';
      summary?: string;
      timestamp: string;
    }>;
  };
}

interface DaemonStateFile {
  pid: number;
  startedAt: string;
  interfaceMode: InterfaceMode;
  tier: InterfaceTier;
  cwd: string;
  socketPath: string;
  runtimePath: string;
  logFile: string;
}

export interface BackgroundStatus {
  running: boolean;
  pid?: number;
  startedAt?: string;
  interfaceMode?: InterfaceMode;
  tier?: InterfaceTier;
  cwd?: string;
  socketPath?: string;
  runtimePath?: string;
  logFile?: string;
}

interface DaemonSocketRequest {
  id: string;
  type: 'status' | 'telemetry' | 'setMode' | 'setTier' | 'shutdown' | 'ping';
  payload?: Record<string, unknown>;
}

interface DaemonSocketResponse {
  id: string;
  ok: boolean;
  result?: any;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

const STATE_DIR = process.env.CODEX_SYNAPTIC_STATE_DIR || join(homedir(), '.codex-synaptic');
const STATE_FILE = join(STATE_DIR, 'daemon.json');
const DEFAULT_SOCKET_FILE = join(STATE_DIR, 'daemon.sock');
const DEFAULT_RUNTIME_FILE = join(STATE_DIR, 'daemon-runtime.json');

function ensureStateDir(): void {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true });
  }
}

function readState(): DaemonStateFile | undefined {
  try {
    if (!existsSync(STATE_FILE)) {
      return undefined;
    }
    const raw = readFileSync(STATE_FILE, 'utf8');
    return JSON.parse(raw) as DaemonStateFile;
  } catch {
    return undefined;
  }
}

function writeState(state: DaemonStateFile): void {
  ensureStateDir();
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function removeState(): void {
  try {
    if (existsSync(STATE_FILE)) {
      unlinkSync(STATE_FILE);
    }
  } catch {
    // ignore
  }
}

function processAlive(pid: number): boolean {
  try {
    return process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      return false;
    }
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      // Process exists but we do not have permission
      return true;
    }
    throw error;
  }
}

function resolveRunnerPath(): { path: string; isTypeScript: boolean } {
  const tsCandidate = resolve(__dirname, 'daemon-runner.ts');
  const jsCandidate = resolve(__dirname, 'daemon-runner.js');

  if (existsSync(jsCandidate)) {
    return { path: jsCandidate, isTypeScript: false };
  }

  return { path: tsCandidate, isTypeScript: true };
}

function getSocketPathFromState(state?: DaemonStateFile): string {
  return state?.socketPath || DEFAULT_SOCKET_FILE;
}

function getRuntimePathFromState(state?: DaemonStateFile): string {
  return state?.runtimePath || DEFAULT_RUNTIME_FILE;
}

export function getDaemonPaths(): {
  stateDir: string;
  stateFile: string;
  socketFile: string;
  runtimeFile: string;
} {
  return {
    stateDir: STATE_DIR,
    stateFile: STATE_FILE,
    socketFile: DEFAULT_SOCKET_FILE,
    runtimeFile: DEFAULT_RUNTIME_FILE
  };
}

export function getBackgroundStatus(): BackgroundStatus {
  const state = readState();
  if (!state) {
    return { running: false };
  }

  if (!processAlive(state.pid)) {
    removeState();
    return { running: false };
  }

  return {
    running: true,
    pid: state.pid,
    startedAt: state.startedAt,
    interfaceMode: state.interfaceMode,
    tier: state.tier,
    cwd: state.cwd,
    socketPath: state.socketPath,
    runtimePath: state.runtimePath,
    logFile: state.logFile
  };
}

export function getBackgroundRuntimeSnapshot(): DaemonRuntimeSnapshot | undefined {
  const state = readState();
  const runtimeFile = getRuntimePathFromState(state);

  try {
    if (!existsSync(runtimeFile)) {
      return undefined;
    }
    const raw = readFileSync(runtimeFile, 'utf8');
    return JSON.parse(raw) as DaemonRuntimeSnapshot;
  } catch {
    return undefined;
  }
}

export async function queryBackgroundRuntimeSnapshot(timeoutMs = 2000): Promise<DaemonRuntimeSnapshot | undefined> {
  const status = getBackgroundStatus();
  if (!status.running) {
    return undefined;
  }

  try {
    const response = await sendDaemonRequest({ type: 'status' }, timeoutMs);
    if (response.ok) {
      return response.result as DaemonRuntimeSnapshot;
    }
  } catch {
    // fall through to file snapshot
  }

  return getBackgroundRuntimeSnapshot();
}

export async function startBackgroundSystem(): Promise<BackgroundStatus> {
  const status = getBackgroundStatus();
  if (status.running) {
    return status;
  }

  const { path: runnerPath, isTypeScript } = resolveRunnerPath();
  const cwd = process.cwd();

  const child = fork(runnerPath, [], {
    cwd,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    execArgv: isTypeScript ? addTsNodeRegister(process.execArgv) : filterExecArgv(process.execArgv)
  });

  const startedAt = new Date().toISOString();

  return new Promise<BackgroundStatus>((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      cleanup();
      try {
        process.kill(child.pid!, 'SIGTERM');
      } catch {
        // ignore
      }
      rejectPromise(new Error('Background system failed to signal readiness in time.'));
    }, 15000);

    const cleanup = () => {
      clearTimeout(timeout);
      child.off('message', onMessage);
      child.off('error', onError);
      child.off('exit', onExit);
    };

    const onMessage = (message: any) => {
      if (!message) return;
      if (message.type === 'ready') {
        cleanup();
        child.unref();
        if (typeof child.disconnect === 'function') {
          child.disconnect();
        }

        const interfaceMode = (message.interfaceMode || 'cli') as InterfaceMode;
        const tier = (message.tier || 'intermediate') as InterfaceTier;
        const socketPath = (message.socketPath || DEFAULT_SOCKET_FILE) as string;
        const runtimePath = (message.runtimePath || DEFAULT_RUNTIME_FILE) as string;
        const logFile = (message.logFile || join(cwd, 'logs', 'daemon.log')) as string;

        writeState({
          pid: child.pid!,
          startedAt,
          interfaceMode,
          tier,
          cwd,
          socketPath,
          runtimePath,
          logFile
        });

        resolvePromise({
          running: true,
          pid: child.pid!,
          startedAt,
          interfaceMode,
          tier,
          cwd,
          socketPath,
          runtimePath,
          logFile
        });
      } else if (message.type === 'error') {
        cleanup();
        rejectPromise(new Error(message.error));
      }
    };

    const onError = (error: Error) => {
      cleanup();
      rejectPromise(error);
    };

    const onExit = (code: number | null) => {
      cleanup();
      if (code === 0) {
        rejectPromise(new Error('Background system exited before signaling readiness.'));
      } else {
        rejectPromise(new Error(`Background system exited unexpectedly (code ${code ?? 'unknown'})`));
      }
    };

    child.on('message', onMessage);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

export async function stopBackgroundSystem(timeoutMs = 10000): Promise<'stopped' | 'not_running' | 'timeout'> {
  const state = readState();
  if (!state) {
    return 'not_running';
  }

  if (!processAlive(state.pid)) {
    removeState();
    return 'not_running';
  }

  try {
    await sendDaemonRequest({ type: 'shutdown' }, Math.min(timeoutMs, 4000));
  } catch {
    // If socket-based shutdown fails we will still signal with SIGTERM below.
  }

  try {
    process.kill(state.pid, 'SIGTERM');
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ESRCH') {
      removeState();
      return 'not_running';
    }
    throw error;
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (!processAlive(state.pid)) {
      removeState();
      return 'stopped';
    }
  }

  try {
    process.kill(state.pid, 'SIGKILL');
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'ESRCH') {
      throw error;
    }
  }

  removeState();
  return 'timeout';
}

export async function restartBackgroundSystem(timeoutMs = 10000): Promise<BackgroundStatus> {
  await stopBackgroundSystem(timeoutMs);
  return startBackgroundSystem();
}

function addTsNodeRegister(execArgv: string[]): string[] {
  const args = [...execArgv];
  const hasTsRegister = args.some((arg) => arg.includes('ts-node/register'));
  if (!hasTsRegister) {
    args.push('-r', 'ts-node/register/transpile-only');
  }
  return filterExecArgv(args);
}

function filterExecArgv(execArgv: string[]): string[] {
  return execArgv.filter((arg) => !arg.startsWith('--inspect'));
}

/**
 * Get the current interface mode from daemon state.
 */
export function getInterfaceMode(): InterfaceMode {
  const state = readState();
  return state?.interfaceMode ?? 'cli';
}

/**
 * Get the current interface tier from daemon state.
 */
export function getInterfaceTier(): InterfaceTier {
  const state = readState();
  return state?.tier ?? 'intermediate';
}

/**
 * Update the daemon state with new interface mode.
 * Used as a local-state fallback if socket messaging is unavailable.
 */
export function setInterfaceMode(mode: InterfaceMode): boolean {
  const state = readState();
  if (!state) {
    return false;
  }

  writeState({
    ...state,
    interfaceMode: mode
  });

  return true;
}

/**
 * Update the daemon state with new interface tier.
 * Used as a local-state fallback if socket messaging is unavailable.
 */
export function setInterfaceTier(tier: InterfaceTier): boolean {
  const state = readState();
  if (!state) {
    return false;
  }

  writeState({
    ...state,
    tier
  });

  return true;
}

/**
 * Update multiple daemon state properties at once.
 */
export function updateDaemonState(updates: Partial<Pick<DaemonStateFile, 'interfaceMode' | 'tier'>>): boolean {
  const state = readState();
  if (!state) {
    return false;
  }

  writeState({
    ...state,
    ...updates
  });

  return true;
}

async function sendDaemonRequest(
  request: Omit<DaemonSocketRequest, 'id'>,
  timeoutMs = 3000
): Promise<DaemonSocketResponse> {
  const status = getBackgroundStatus();
  if (!status.running || !status.pid) {
    throw new Error('Background daemon is not running.');
  }

  const state = readState();
  const socketPath = getSocketPathFromState(state);

  return new Promise<DaemonSocketResponse>((resolvePromise, rejectPromise) => {
    const id = randomUUID();
    const socket = createConnection(socketPath);
    let settled = false;
    let buffered = '';

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      rejectPromise(new Error(`Daemon request timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      socket.removeAllListeners();
    };

    socket.once('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      rejectPromise(error);
    });

    socket.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.length) {
          continue;
        }

        try {
          const payload = JSON.parse(trimmed) as DaemonSocketResponse;
          if (payload.id !== id) {
            continue;
          }

          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          socket.end();
          resolvePromise(payload);
          return;
        } catch (error) {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          socket.destroy();
          rejectPromise(error as Error);
          return;
        }
      }
    });

    socket.once('connect', () => {
      const payload: DaemonSocketRequest = {
        id,
        type: request.type,
        payload: request.payload
      };
      socket.write(`${JSON.stringify(payload)}\n`);
    });
  });
}

/**
 * Send a daemon command through the socket channel.
 */
export async function sendDaemonMessage(message: DaemonIPCMessage): Promise<boolean> {
  const state = readState();
  if (!state || !processAlive(state.pid)) {
    return false;
  }

  try {
    if (message.type === 'setMode') {
      const response = await sendDaemonRequest({
        type: 'setMode',
        payload: { mode: message.mode }
      });
      if (response.ok) {
        updateDaemonState({ interfaceMode: message.mode });
      }
      return response.ok;
    }

    if (message.type === 'setTier') {
      const response = await sendDaemonRequest({
        type: 'setTier',
        payload: { tier: message.tier }
      });
      if (response.ok) {
        updateDaemonState({ tier: message.tier });
      }
      return response.ok;
    }

    if (message.type === 'shutdown') {
      const response = await sendDaemonRequest({ type: 'shutdown' });
      return response.ok;
    }

    if (message.type === 'getMode') {
      const response = await sendDaemonRequest({ type: 'status' });
      return response.ok;
    }

    return false;
  } catch {
    // Socket channel unavailable; use state file fallback where possible.
    if (message.type === 'setMode') {
      return setInterfaceMode(message.mode);
    }
    if (message.type === 'setTier') {
      return setInterfaceTier(message.tier);
    }
    return false;
  }
}

/**
 * Request interface mode switch through the daemon.
 */
export async function requestModeSwitch(
  targetMode: InterfaceMode,
  options: { tier?: InterfaceTier } = {}
): Promise<{ success: boolean; currentMode: InterfaceMode; currentTier: InterfaceTier }> {
  const status = getBackgroundStatus();

  if (!status.running) {
    return {
      success: false,
      currentMode: 'cli',
      currentTier: 'intermediate'
    };
  }

  let success = await sendDaemonMessage({ type: 'setMode', mode: targetMode });
  if (success && options.tier) {
    success = await sendDaemonMessage({ type: 'setTier', tier: options.tier });
  }

  if (success) {
    const snapshot = await queryBackgroundRuntimeSnapshot(2000);
    if (snapshot) {
      return {
        success: true,
        currentMode: snapshot.interfaceMode,
        currentTier: snapshot.tier
      };
    }
  }

  return {
    success,
    currentMode: success ? targetMode : (status.interfaceMode ?? 'cli'),
    currentTier: success ? (options.tier ?? status.tier ?? 'intermediate') : (status.tier ?? 'intermediate')
  };
}
