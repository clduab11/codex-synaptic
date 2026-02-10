import { CodexSynapticSystem } from '../core/system.js';
import { Logger } from '../core/logger.js';
import { ConfigurationManager, InterfaceMode, InterfaceTier } from '../core/config.js';
import type { DaemonIPCMessage } from './daemon-manager.js';

interface ReadyMessage {
  type: 'ready';
  pid: number;
  interfaceMode: InterfaceMode;
  tier: InterfaceTier;
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

const logger = Logger.getInstance('daemon');

/**
 * Daemon state for interface mode tracking
 */
interface DaemonState {
  currentMode: InterfaceMode;
  currentTier: InterfaceTier;
}

async function main() {
  process.env.CODEX_SYNAPTIC_DAEMON_ACTIVE = '1';
  const system = new CodexSynapticSystem();
  const configManager = new ConfigurationManager();
  
  // Initialize daemon state from configuration
  const daemonState: DaemonState = {
    currentMode: 'cli',
    currentTier: 'intermediate'
  };

  const notify = (message: DaemonMessage) => {
    if (typeof process.send === 'function') {
      process.send(message);
    }
  };

  /**
   * Handle mode change request
   */
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
      
      // Update daemon state
      daemonState.currentMode = targetMode;
      if (targetTier) {
        daemonState.currentTier = targetTier;
      }
      
      // Notify parent process of mode change
      notify({
        type: 'modeChanged',
        mode: daemonState.currentMode,
        tier: daemonState.currentTier
      });
      
      logger.info('daemon', 'Mode change completed', {
        mode: daemonState.currentMode,
        tier: daemonState.currentTier
      });
      
    } catch (error) {
      // Rollback on failure
      daemonState.currentMode = previousMode;
      daemonState.currentTier = previousTier;
      logger.error('daemon', 'Mode change failed, rolled back', {
        targetMode,
        error: (error as Error).message
      });
    }
  };

  try {
    // Load configuration to get initial interface settings
    await configManager.load();
    const config = configManager.get();
    
    if (config.interface) {
      daemonState.currentMode = config.interface.mode;
      daemonState.currentTier = config.interface.tui?.tier ?? config.interface.gui?.tier ?? 'intermediate';
    }
    
    await system.initialize();
    notify({
      type: 'ready',
      pid: process.pid,
      interfaceMode: daemonState.currentMode,
      tier: daemonState.currentTier
    });
    logger.info('daemon', 'Background Codex-Synaptic system initialized', {
      mode: daemonState.currentMode,
      tier: daemonState.currentTier
    });
  } catch (error) {
    const err = error as Error;
    logger.error('daemon', 'Failed to initialize background system', undefined, err);
    notify({ type: 'error', error: err.message });
    process.exit(1);
    return;
  }

  const shutdown = async (reason: string) => {
    try {
      logger.info('daemon', 'Shutting down background system', { reason });
      await system.shutdown();
      logger.info('daemon', 'Background system shutdown complete');
    } catch (error) {
      logger.error('daemon', 'Error during background shutdown', { reason }, error as Error);
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => {
    void shutdown('sigterm');
  });

  process.on('SIGINT', () => {
    void shutdown('sigint');
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
