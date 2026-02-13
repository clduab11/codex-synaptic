import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { FC } from 'react';
import type { InterfaceTier } from '../core/config.js';

export interface TuiRuntimeSnapshot {
  source: 'local' | 'daemon';
  pid?: number;
  startedAt?: string;
  updatedAt?: string;
  cwd?: string;
  interfaceMode?: string;
  tier?: InterfaceTier;
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
    resources?: {
      memoryMB?: number;
      cpuPercent?: number;
      activeAgents?: number;
      concurrentTasks?: number;
      requestsPerMinute?: number;
    };
    mesh?: {
      topology?: string;
      nodeCount?: number;
      connectionCount?: number;
    };
    swarm?: {
      isRunning?: boolean;
      algorithm?: string;
      particleCount?: number;
      isOptimizing?: boolean;
    };
    consensus?: {
      isRunning?: boolean;
      activeProposals?: number;
      totalVotes?: number;
    };
    recentTasks: Array<{
      id: string;
      status: 'completed' | 'failed';
      summary?: string;
      timestamp: string;
    }>;
  };
}

export interface TuiSnapshotProvider {
  sourceLabel: string;
  refreshIntervalMs?: number;
  fetchSnapshot: () => Promise<TuiRuntimeSnapshot>;
}

interface InkBindings {
  Box: React.ComponentType<any>;
  Text: React.ComponentType<any>;
  useInput: (handler: (input: string, key: any) => void) => void;
  useApp: () => { exit: () => void };
}

export interface TuiAppProps {
  provider: TuiSnapshotProvider;
  initialTier?: InterfaceTier;
  onExit?: () => void;
  ink: InkBindings;
}

export interface TuiContextValue {
  snapshot?: TuiRuntimeSnapshot;
  loading: boolean;
  error?: string;
  refreshedAt?: Date;
}

export const TuiContext = React.createContext<TuiContextValue | null>(null);

export function useTui(): TuiContextValue {
  const context = React.useContext(TuiContext);
  if (!context) {
    throw new Error('useTui must be used within TuiApp');
  }
  return context;
}

function truncate(input: string, max = 100): string {
  if (input.length <= max) {
    return input;
  }
  return `${input.slice(0, max - 1)}…`;
}

function formatUpdatedLabel(snapshot?: TuiRuntimeSnapshot, refreshedAt?: Date): string {
  const updatedAt = snapshot?.updatedAt ? new Date(snapshot.updatedAt) : refreshedAt;
  if (!updatedAt) {
    return 'unknown';
  }
  return updatedAt.toLocaleTimeString();
}

export const TuiApp: FC<TuiAppProps> = ({ provider, onExit, ink }) => {
  const { Box, Text, useInput, useApp } = ink;
  const { exit } = useApp();

  const [snapshot, setSnapshot] = useState<TuiRuntimeSnapshot | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [refreshedAt, setRefreshedAt] = useState<Date | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const next = await provider.fetchSnapshot();
      setSnapshot(next);
      setError(undefined);
      setRefreshedAt(new Date());
    } catch (refreshError) {
      setError((refreshError as Error).message);
    } finally {
      setLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, provider.refreshIntervalMs ?? 1000);
    return () => clearInterval(interval);
  }, [provider.refreshIntervalMs, refresh]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      onExit?.();
      exit();
      return;
    }

    if (input === 'q') {
      onExit?.();
      exit();
      return;
    }

    if (input === 'r') {
      void refresh();
    }
  });

  const contextValue = useMemo<TuiContextValue>(() => ({
    snapshot,
    loading,
    error,
    refreshedAt
  }), [snapshot, loading, error, refreshedAt]);

  const recentTasks = snapshot?.telemetry.recentTasks ?? [];

  return (
    <TuiContext.Provider value={contextValue}>
      <Box flexDirection="column" padding={1}>
        <Text color="cyan">Codex-Synaptic TUI ({provider.sourceLabel})</Text>
        <Text color="gray">Shortcuts: q=quit, r=refresh</Text>
        <Text color="gray">Last update: {formatUpdatedLabel(snapshot, refreshedAt)}</Text>

        {loading && <Text color="yellow">Loading telemetry…</Text>}
        {error && <Text color="red">Error: {error}</Text>}

        {snapshot && (
          <>
            <Box marginTop={1} flexDirection="column">
              <Text>
                Runtime: {snapshot.status.initialized ? 'ready' : 'not ready'} | source={snapshot.source} | daemon={snapshot.status.daemon ? 'yes' : 'no'}
              </Text>
              <Text>
                Interface: {snapshot.interfaceMode ?? 'unknown'}/{snapshot.tier ?? 'unknown'} | shuttingDown={snapshot.status.shuttingDown ? 'yes' : 'no'}
              </Text>
              {snapshot.cwd && <Text>CWD: {truncate(snapshot.cwd, 120)}</Text>}
            </Box>

            <Box marginTop={1} flexDirection="column">
              <Text color="green">Agents</Text>
              <Text>
                total={snapshot.telemetry.agents.total} available={snapshot.telemetry.agents.available}
              </Text>
            </Box>

            <Box marginTop={1} flexDirection="column">
              <Text color="green">Resources</Text>
              <Text>
                cpu={snapshot.telemetry.resources?.cpuPercent?.toFixed(2) ?? 'n/a'}%
                {' | '}
                memory={snapshot.telemetry.resources?.memoryMB?.toFixed(1) ?? 'n/a'}MB
                {' | '}
                tasks={snapshot.telemetry.resources?.concurrentTasks ?? 'n/a'}
              </Text>
            </Box>

            <Box marginTop={1} flexDirection="column">
              <Text color="green">Mesh / Swarm / Consensus</Text>
              <Text>
                mesh={snapshot.telemetry.mesh?.topology ?? 'n/a'}
                {' | '}
                swarm={snapshot.telemetry.swarm?.algorithm ?? 'n/a'}
                {' | '}
                consensusVotes={snapshot.telemetry.consensus?.totalVotes ?? 'n/a'}
              </Text>
            </Box>

            <Box marginTop={1} flexDirection="column">
              <Text color="green">Recent Tasks</Text>
              {recentTasks.length === 0 && <Text color="gray">No recent tasks</Text>}
              {recentTasks.slice(0, 6).map((task, index) => (
                <Text key={`${task.id}-${index}`}>
                  {index + 1}. {task.status.toUpperCase()} {task.id} {task.summary ? `- ${truncate(task.summary, 80)}` : ''}
                </Text>
              ))}
            </Box>
          </>
        )}
      </Box>
    </TuiContext.Provider>
  );
};

export interface StartTuiOptions {
  provider: TuiSnapshotProvider;
  onExit?: () => void;
  initialTier?: InterfaceTier;
}

function renderFallbackMessage(provider: TuiSnapshotProvider): void {
  console.log('TUI dependencies are not installed.');
  console.log('Install with: npm install ink');
  console.log(`Falling back to snapshot mode (${provider.sourceLabel}).`);
}

export async function startTui(options: StartTuiOptions): Promise<void> {
  const { provider, onExit, initialTier } = options;

  let inkModule: any;
  try {
    inkModule = await import('ink');
  } catch {
    renderFallbackMessage(provider);
    const snapshot = await provider.fetchSnapshot();
    console.log(`Runtime ready: ${snapshot.status.initialized ? 'yes' : 'no'}`);
    console.log(`Agents: ${snapshot.telemetry.agents.total}`);
    onExit?.();
    return;
  }

  const { render, Box, Text, useInput, useApp } = inkModule;
  const { waitUntilExit } = render(
    <TuiApp
      provider={provider}
      initialTier={initialTier}
      onExit={onExit}
      ink={{ Box, Text, useInput, useApp }}
    />,
    {
      exitOnCtrlC: true
    }
  );

  await waitUntilExit();
}

export default TuiApp;
