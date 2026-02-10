/**
 * TUI Types and Interfaces
 * 
 * Type definitions for the Ink-based Terminal User Interface.
 */

import type { InterfaceTier } from '../core/config.js';
import type { AnyOutputPayload, ProgressPayload } from '../rendering/contracts.js';

/**
 * TUI theme configuration
 */
export interface TuiTheme {
  name: 'dark' | 'light' | 'high-contrast';
  colors: {
    primary: string;
    secondary: string;
    success: string;
    warning: string;
    error: string;
    info: string;
    background: string;
    foreground: string;
    muted: string;
    border: string;
    highlight: string;
  };
  unicode: boolean;
}

/**
 * TUI navigation state
 */
export interface TuiNavigationState {
  currentView: TuiViewType;
  previousView?: TuiViewType;
  breadcrumbs: string[];
  selectedIndex: number;
  scrollOffset: number;
}

/**
 * Available TUI view types
 */
export type TuiViewType =
  | 'dashboard'
  | 'agents'
  | 'tasks'
  | 'mesh'
  | 'swarm'
  | 'consensus'
  | 'memory'
  | 'settings'
  | 'help'
  | 'logs';

/**
 * TUI shortcut definition
 */
export interface TuiShortcut {
  key: string;
  label: string;
  description: string;
  action: () => void;
  tier?: InterfaceTier;
}

/**
 * TUI panel configuration
 */
export interface TuiPanel {
  id: string;
  title: string;
  visible: boolean;
  position: 'left' | 'right' | 'top' | 'bottom' | 'center';
  width?: number | string;
  height?: number | string;
  minTier?: InterfaceTier;
}

/**
 * TUI state managed by the app
 */
export interface TuiState {
  navigation: TuiNavigationState;
  theme: TuiTheme;
  tier: InterfaceTier;
  refreshInterval: number;
  showShortcuts: boolean;
  animations: boolean;
  panels: TuiPanel[];
  pendingOutput: AnyOutputPayload[];
  activeProgress: Map<string, ProgressPayload>;
  connected: boolean;
  lastUpdate: Date;
}

/**
 * TUI action types for state updates
 */
export type TuiAction =
  | { type: 'NAVIGATE'; view: TuiViewType }
  | { type: 'GO_BACK' }
  | { type: 'SET_THEME'; theme: TuiTheme['name'] }
  | { type: 'SET_TIER'; tier: InterfaceTier }
  | { type: 'SET_REFRESH_INTERVAL'; interval: number }
  | { type: 'TOGGLE_SHORTCUTS' }
  | { type: 'TOGGLE_ANIMATIONS' }
  | { type: 'TOGGLE_PANEL'; panelId: string }
  | { type: 'ADD_OUTPUT'; payload: AnyOutputPayload }
  | { type: 'CLEAR_OUTPUT' }
  | { type: 'UPDATE_PROGRESS'; id: string; progress: Partial<ProgressPayload> }
  | { type: 'COMPLETE_PROGRESS'; id: string }
  | { type: 'SET_CONNECTED'; connected: boolean }
  | { type: 'SET_SELECTION'; index: number }
  | { type: 'SCROLL'; offset: number };

/**
 * Dashboard widget data
 */
export interface DashboardWidget {
  id: string;
  type: 'metric' | 'chart' | 'status' | 'list';
  title: string;
  data: unknown;
  minTier?: InterfaceTier;
  refreshFn?: () => Promise<unknown>;
}

/**
 * Agent status for display
 */
export interface AgentDisplayData {
  id: string;
  type: string;
  status: 'idle' | 'busy' | 'error' | 'offline';
  currentTask?: string;
  metrics: {
    tasksCompleted: number;
    successRate: number;
    avgDuration: number;
  };
}

/**
 * Task status for display
 */
export interface TaskDisplayData {
  id: string;
  prompt: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  assignedAgent?: string;
  progress?: number;
  startedAt?: Date;
  completedAt?: Date;
  result?: unknown;
}

/**
 * Mesh node for display
 */
export interface MeshNodeDisplayData {
  id: string;
  type: string;
  connections: number;
  load: number;
  status: 'healthy' | 'degraded' | 'offline';
}

/**
 * Swarm status for display
 */
export interface SwarmDisplayData {
  active: boolean;
  algorithm: string;
  agents: number;
  iteration: number;
  bestFitness?: number;
  convergence?: number;
}

/**
 * Consensus proposal for display
 */
export interface ConsensusDisplayData {
  id: string;
  type: string;
  proposer: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  votes: { for: number; against: number; abstain: number };
  deadline?: Date;
}

/**
 * Memory entry for display
 */
export interface MemoryDisplayData {
  id: number;
  namespace: string;
  key: string;
  preview: string;
  createdAt: Date;
  tags: string[];
}

/**
 * Log entry for display
 */
export interface LogDisplayData {
  timestamp: Date;
  level: 'debug' | 'info' | 'warn' | 'error';
  source: string;
  message: string;
  details?: Record<string, unknown>;
}
