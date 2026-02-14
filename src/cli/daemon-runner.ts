import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { createServer, type Server, type Socket } from 'net';
import { CodexSynapticSystem } from '../core/system.js';
import { Logger } from '../core/logger.js';
import { ConfigurationManager, InterfaceMode, InterfaceTier } from '../core/config.js';
import type { DaemonIPCMessage, DaemonRuntimeSnapshot } from './daemon-manager.js';

interface ReadyMessage {
  type: 'ready';
  pid: number;
  interfaceMode: InterfaceMode;
  tier: InterfaceTier;
  socketPath: string;
  runtimePath: string;
  logFile: string;
}

interface ErrorMessage {
  type: 'error';
  error: string;
}

interface ModeChangedMessage {
  type: 'modeChanged';
  mode: InterfaceMode;
  tier: InterfaceTier;
}

type DaemonMessage = ReadyMessage | ErrorMessage | ModeChangedMessage;

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

const logger = Logger.getInstance('daemon');

interface DaemonState {
  currentMode: InterfaceMode;
  currentTier: InterfaceTier;
}

interface TaskRecord {
  id: string;
  status: 'completed' | 'failed';
  summary?: string;
  timestamp: string;
}

const STATE_DIR = process.env.CODEX_SYNAPTIC_STATE_DIR || join(homedir(), '.codex-synaptic');
const SOCKET_FILE = join(STATE_DIR, 'daemon.sock');
const RUNTIME_FILE = join(STATE_DIR, 'daemon-runtime.json');

function ensureStateDir(): void {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true });
  }
}

function safeUnlink(path: string): void {
  try {
    if (existsSync(path)) {
      unlinkSync(path);
    }
  } catch {
    // ignore
  }
}

async function main() {
  process.env.CODEX_SYNAPTIC_DAEMON_ACTIVE = '1';

  ensureStateDir();
  safeUnlink(SOCKET_FILE);

  const startedAt = new Date().toISOString();
  const cwd = process.cwd();
  const logFile = join(cwd, 'logs', 'daemon.log');

  const system = new CodexSynapticSystem();
  const configManager = new ConfigurationManager();
  let socketServer: Server | undefined;
  let runtimeTimer: NodeJS.Timeout | undefined;

  const daemonState: DaemonState = {
    currentMode: 'cli',
    currentTier: 'intermediate'
  };

  const recentTasks: TaskRecord[] = [];

  const pushTask = (task: { id?: string; result?: any; error?: any; type?: string }, status: 'completed' | 'failed') => {
    const record: TaskRecord = {
      id: task.id ?? `task-${Date.now()}`,
      status,
      summary: status === 'completed'
        ? (typeof task.result?.summary === 'string' ? task.result.summary : task.type)
        : (typeof task.error === 'string' ? task.error : task.type),
      timestamp: new Date().toISOString()
    };
    recentTasks.unshift(record);
    if (recentTasks.length > 20) {
      recentTasks.splice(20);
    }
  };

  const notify = (message: DaemonMessage) => {
    if (typeof process.send === 'function') {
      process.send(message);
    }
  };

  const buildSnapshot = (): DaemonRuntimeSnapshot => {
    const status = system.getStatus();
    const registryStatus = system.getAgentRegistry().getStatus();
    return {
      pid: process.pid,
      startedAt,
      updatedAt: new Date().toISOString(),
      cwd,
      interfaceMode: daemonState.currentMode,
      tier: daemonState.currentTier,
      status: {
        initialized: Boolean(status?.initialized),
        shuttingDown: Boolean(status?.shuttingDown),
        daemon: true
      },
      telemetry: {
        agents: {
          total: registryStatus.totalAgents,
          available: registryStatus.availableAgents,
          byType: { ...registryStatus.typeCounts },
          byStatus: { ...registryStatus.statusCounts }
        },
        resources: system.getResourceManager().getCurrentUsage(),
        mesh: system.getNeuralMesh().getStatus(),
        swarm: system.getSwarmCoordinator().getStatus(),
        consensus: system.getConsensusManager().getStatus(),
        recentTasks: [...recentTasks]
      }
    };
  };

  const persistSnapshot = async () => {
    try {
      const snapshot = buildSnapshot();
      await writeFile(RUNTIME_FILE, JSON.stringify(snapshot, null, 2), 'utf8');
    } catch (error) {
      logger.debug('daemon', 'Failed to persist runtime snapshot', {
        error: (error as Error).message
      });
    }
  };

  const validateMode = (value: unknown): value is InterfaceMode => {
    return value === 'cli' || value === 'tui' || value === 'gui';
  };

  const validateTier = (value: unknown): value is InterfaceTier => {
    return value === 'beginner' || value === 'intermediate' || value === 'advanced';
  };

  const respond = (socket: Socket, payload: DaemonSocketResponse) => {
    socket.write(`${JSON.stringify(payload)}\n`);
  };

  const handleSocketMessage = async (socket: Socket, request: DaemonSocketRequest): Promise<void> => {
    try {
      switch (request.type) {
        case 'ping':
          respond(socket, { id: request.id, ok: true, result: { pid: process.pid } });
          return;

        case 'status':
          respond(socket, { id: request.id, ok: true, result: buildSnapshot() });
          return;

        case 'telemetry':
          respond(socket, { id: request.id, ok: true, result: buildSnapshot().telemetry });
          return;

        case 'setMode': {
          const mode = request.payload?.mode;
          if (!validateMode(mode)) {
            respond(socket, {
              id: request.id,
              ok: false,
              error: {
                code: 'invalid_mode',
                message: 'Mode must be one of cli|tui|gui.'
              }
            });
            return;
          }

          daemonState.currentMode = mode;
          notify({ type: 'modeChanged', mode: daemonState.currentMode, tier: daemonState.currentTier });
          void persistSnapshot().catch(err => logger.debug('daemon', 'Background persist failed', { error: err.message }));
          respond(socket, {
            id: request.id,
            ok: true,
            result: { mode: daemonState.currentMode, tier: daemonState.currentTier }
          });
          return;
        }

        case 'setTier': {
          const tier = request.payload?.tier;
          if (!validateTier(tier)) {
            respond(socket, {
              id: request.id,
              ok: false,
              error: {
                code: 'invalid_tier',
                message: 'Tier must be one of beginner|intermediate|advanced.'
              }
            });
            return;
          }

          daemonState.currentTier = tier;
          notify({ type: 'modeChanged', mode: daemonState.currentMode, tier: daemonState.currentTier });
          void persistSnapshot().catch(err => logger.debug('daemon', 'Background persist failed', { error: err.message }));
          respond(socket, {
            id: request.id,
            ok: true,
            result: { mode: daemonState.currentMode, tier: daemonState.currentTier }
          });
          return;
        }

        case 'shutdown':
          respond(socket, { id: request.id, ok: true, result: { accepted: true } });
          setTimeout(() => {
            void shutdown('socket-shutdown');
          }, 25);
          return;

        default:
          respond(socket, {
            id: request.id,
            ok: false,
            error: {
              code: 'unsupported_request',
              message: `Unsupported request type: ${request.type}`
            }
          });
      }
    } catch (error) {
      respond(socket, {
        id: request.id,
        ok: false,
        error: {
          code: 'internal_error',
          message: (error as Error).message
        }
      });
    }
  };

  const createSocketServer = async (): Promise<Server> => {
    const server = createServer((socket) => {
      let buffered = '';

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
            const request = JSON.parse(trimmed) as DaemonSocketRequest;
            void handleSocketMessage(socket, request);
          } catch (error) {
            const badId = `bad-${Date.now()}`;
            respond(socket, {
              id: badId,
              ok: false,
              error: {
                code: 'invalid_json',
                message: (error as Error).message
              }
            });
          }
        }
      });
    });

    await new Promise<void>((resolvePromise, rejectPromise) => {
      const onError = (error: Error) => rejectPromise(error);
      server.once('error', onError);
      server.listen(SOCKET_FILE, () => {
        server.off('error', onError);
        resolvePromise();
      });
    });

    return server;
  };

  const handleModeChange = async (targetMode: InterfaceMode, targetTier?: InterfaceTier) => {
    const previousMode = daemonState.currentMode;
    const previousTier = daemonState.currentTier;

    try {
      logger.info('daemon', 'Mode change requested', {
        from: previousMode,
        to: targetMode,
        tierFrom: previousTier,
        tierTo: targetTier ?? previousTier
      });

      daemonState.currentMode = targetMode;
      if (targetTier) {
        daemonState.currentTier = targetTier;
      }

      notify({
        type: 'modeChanged',
        mode: daemonState.currentMode,
        tier: daemonState.currentTier
      });

      logger.info('daemon', 'Mode change completed', {
        mode: daemonState.currentMode,
        tier: daemonState.currentTier
      });

      await persistSnapshot();
    } catch (error) {
      daemonState.currentMode = previousMode;
      daemonState.currentTier = previousTier;
      logger.error('daemon', 'Mode change failed, rolled back', {
        targetMode,
        error: (error as Error).message
      });
    }
  };

  try {
    await configManager.load();
    const config = configManager.get();

    if (config.interface) {
      daemonState.currentMode = config.interface.mode;
      daemonState.currentTier = config.interface.tui?.tier ?? config.interface.gui?.tier ?? 'intermediate';
    }

    await system.initialize();

    system.on('taskCompleted', (task: any) => pushTask(task, 'completed'));
    system.on('taskFailed', (task: any) => pushTask(task, 'failed'));

    socketServer = await createSocketServer();

    await persistSnapshot();
    runtimeTimer = setInterval(() => {
      void persistSnapshot().catch(err => logger.debug('daemon', 'Periodic persist failed', { error: err.message }));
    }, 1000);
    if (typeof runtimeTimer.unref === 'function') {
      runtimeTimer.unref();
    }

    notify({
      type: 'ready',
      pid: process.pid,
      interfaceMode: daemonState.currentMode,
      tier: daemonState.currentTier,
      socketPath: SOCKET_FILE,
      runtimePath: RUNTIME_FILE,
      logFile
    });

    logger.info('daemon', 'Background Codex-Synaptic system initialized', {
      mode: daemonState.currentMode,
      tier: daemonState.currentTier,
      socketPath: SOCKET_FILE,
      runtimePath: RUNTIME_FILE
    });
  } catch (error) {
    const err = error as Error;
    logger.error('daemon', 'Failed to initialize background system', undefined, err);
    notify({ type: 'error', error: err.message });
    safeUnlink(SOCKET_FILE);
    process.exit(1);
    return;
  }

  const shutdown = async (reason: string) => {
    try {
      logger.info('daemon', 'Shutting down background system', { reason });
      if (runtimeTimer) {
        clearInterval(runtimeTimer);
        runtimeTimer = undefined;
      }
      if (socketServer) {
        await new Promise<void>((resolvePromise) => {
          socketServer?.close(() => resolvePromise());
        });
        socketServer = undefined;
      }
      await persistSnapshot();
      await system.shutdown();
      logger.info('daemon', 'Background system shutdown complete');
    } catch (error) {
      logger.error('daemon', 'Error during background shutdown', { reason }, error as Error);
    } finally {
      safeUnlink(SOCKET_FILE);
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => {
    void shutdown('sigterm');
  });

  process.on('SIGINT', () => {
    void shutdown('sigint');
  });

  process.on('exit', () => {
    safeUnlink(SOCKET_FILE);
  });

  process.on('message', (message: unknown) => {
    const msg = message as DaemonIPCMessage | null;
    if (!msg) return;

    switch (msg.type) {
      case 'shutdown':
        void shutdown('message');
        break;

      case 'setMode':
        void handleModeChange(msg.mode);
        break;

      case 'setTier':
        void handleModeChange(daemonState.currentMode, msg.tier);
        break;

      case 'getMode':
        notify({
          type: 'modeChanged',
          mode: daemonState.currentMode,
          tier: daemonState.currentTier
        });
        break;
    }
  });
}

void main();
