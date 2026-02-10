import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { fork, ChildProcess } from 'child_process';
import type { InterfaceMode, InterfaceTier } from '../core/config.js';

/**
 * IPC message types for daemon communication
 */
export type DaemonIPCMessage =
  | { type: 'setMode'; mode: InterfaceMode }
  | { type: 'getMode' }
  | { type: 'modeChanged'; mode: InterfaceMode; tier: InterfaceTier }
  | { type: 'setTier'; tier: InterfaceTier }
  | { type: 'shutdown' };

interface DaemonStateFile {
  pid: number;
  startedAt: string;
  interfaceMode: InterfaceMode;
  tier: InterfaceTier;
}

export interface BackgroundStatus {
  running: boolean;
  pid?: number;
  startedAt?: string;
  interfaceMode?: InterfaceMode;
  tier?: InterfaceTier;
}

const STATE_DIR = join(homedir(), '.codex-synaptic');
const STATE_FILE = join(STATE_DIR, 'daemon.json');

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
    tier: state.tier
  };
}

export async function startBackgroundSystem(): Promise<BackgroundStatus> {
  const status = getBackgroundStatus();
  if (status.running) {
    return status;
  }

  const { path: runnerPath, isTypeScript } = resolveRunnerPath();

  const child = fork(runnerPath, [], {
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
        const interfaceMode = message.interfaceMode || 'cli';
        const tier = message.tier || 'intermediate';
        writeState({ pid: child.pid!, startedAt, interfaceMode, tier });
        resolvePromise({ running: true, pid: child.pid!, startedAt, interfaceMode, tier });
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
        // Exited cleanly before signaling readiness
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

  // Attempt force kill
  try {
    process.kill(state.pid, 'SIGKILL');
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'ESRCH') {
      throw error;
    }
  }

  removeState();
  return 'stopped';
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
  // Remove debugging flags that would prevent daemonizing cleanly
  return execArgv.filter((arg) => !arg.startsWith('--inspect'));
}

/**
 * Get the current interface mode from daemon state
 */
export function getInterfaceMode(): InterfaceMode {
  const state = readState();
  return state?.interfaceMode ?? 'cli';
}

/**
 * Get the current interface tier from daemon state
 */
export function getInterfaceTier(): InterfaceTier {
  const state = readState();
  return state?.tier ?? 'intermediate';
}

/**
 * Update the daemon state with new interface mode
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
 * Update the daemon state with new interface tier
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
 * Update multiple daemon state properties at once
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

/**
 * Send an IPC message to the running daemon
 * Returns false if daemon is not running or message fails to send
 */
export async function sendDaemonMessage(message: DaemonIPCMessage): Promise<boolean> {
  const state = readState();
  if (!state || !processAlive(state.pid)) {
    return false;
  }
  
  // Note: Direct IPC messaging requires a connected child process
  // For now, we update state file which daemon can poll
  // Future: implement proper IPC channel reconnection
  
  if (message.type === 'setMode') {
    return setInterfaceMode(message.mode);
  }
  
  if (message.type === 'setTier') {
    return setInterfaceTier(message.tier);
  }
  
  return false;
}

/**
 * Request interface mode switch through the daemon
 * This updates state and can trigger mode transition
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
  
  const updates: Partial<Pick<DaemonStateFile, 'interfaceMode' | 'tier'>> = {
    interfaceMode: targetMode
  };
  
  if (options.tier) {
    updates.tier = options.tier;
  }
  
  const success = updateDaemonState(updates);
  
  return {
    success,
    currentMode: success ? targetMode : (status.interfaceMode ?? 'cli'),
    currentTier: success ? (options.tier ?? status.tier ?? 'intermediate') : (status.tier ?? 'intermediate')
  };
}
