/**
 * GUI Types and Interfaces
 * 
 * Type definitions for the Electron-based Graphical User Interface.
 */

import type { InterfaceTier } from '../core/config.js';

/**
 * GUI window state
 */
export interface GuiWindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized: boolean;
  isFullscreen: boolean;
}

/**
 * GUI theme configuration
 */
export interface GuiTheme {
  name: 'dark' | 'light' | 'system';
  accentColor: string;
  fontFamily: string;
  fontSize: number;
  borderRadius: number;
}

/**
 * GUI navigation item
 */
export interface GuiNavItem {
  id: string;
  label: string;
  icon: string;
  route: string;
  badge?: number;
  minTier?: InterfaceTier;
  children?: GuiNavItem[];
}

/**
 * GUI notification
 */
export interface GuiNotification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  action?: {
    label: string;
    handler: string;
  };
}

/**
 * GUI application state
 */
export interface GuiAppState {
  window: GuiWindowState;
  theme: GuiTheme;
  tier: InterfaceTier;
  currentRoute: string;
  sidebarCollapsed: boolean;
  systemTrayEnabled: boolean;
  notifications: GuiNotification[];
  connected: boolean;
  apiPort: number;
  lastSync: Date | null;
}

/**
 * IPC channels for main-renderer communication
 */
export type GuiIpcChannel =
  | 'gui:getState'
  | 'gui:setState'
  | 'gui:navigate'
  | 'gui:setTheme'
  | 'gui:setTier'
  | 'gui:toggleSidebar'
  | 'gui:toggleSystemTray'
  | 'gui:clearNotifications'
  | 'gui:dismissNotification'
  | 'gui:executeCommand'
  | 'gui:getSystemStatus'
  | 'gui:getAgents'
  | 'gui:getTasks'
  | 'gui:getMeshStatus'
  | 'gui:getSwarmStatus'
  | 'gui:getConsensusStatus'
  | 'gui:getMemoryEntries'
  | 'gui:submitTask'
  | 'gui:deployAgent'
  | 'gui:startSwarm'
  | 'gui:stopSwarm'
  | 'gui:proposeConsensus'
  | 'gui:voteConsensus';

/**
 * IPC message structure
 */
export interface GuiIpcMessage<T = unknown> {
  channel: GuiIpcChannel;
  requestId: string;
  payload: T;
}

/**
 * IPC response structure
 */
export interface GuiIpcResponse<T = unknown> {
  requestId: string;
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * System status for GUI display
 */
export interface GuiSystemStatus {
  initialized: boolean;
  uptime: number;
  agents: {
    total: number;
    active: number;
    idle: number;
    error: number;
  };
  tasks: {
    pending: number;
    running: number;
    completed: number;
    failed: number;
  };
  mesh: {
    nodes: number;
    connections: number;
    health: 'healthy' | 'degraded' | 'offline';
  };
  swarm: {
    active: boolean;
    algorithm?: string;
    iteration?: number;
  };
  consensus: {
    activeProp: number;
    mode: string;
  };
  resources: {
    cpuUsage: number;
    memoryUsage: number;
    gpuAvailable: boolean;
  };
}

/**
 * Dashboard widget configuration
 */
export interface GuiDashboardWidget {
  id: string;
  type: 'metric' | 'chart' | 'list' | 'status' | 'activity';
  title: string;
  gridArea: string;
  minTier?: InterfaceTier;
  refreshInterval?: number;
  config?: Record<string, unknown>;
}

/**
 * Chart data point
 */
export interface GuiChartDataPoint {
  timestamp: Date;
  value: number;
  label?: string;
}

/**
 * Activity log entry
 */
export interface GuiActivityEntry {
  id: string;
  type: 'task' | 'agent' | 'consensus' | 'system';
  action: string;
  details: string;
  timestamp: Date;
  severity: 'info' | 'success' | 'warning' | 'error';
}

/**
 * Menu bar configuration
 */
export interface GuiMenuConfig {
  file: GuiMenuItem[];
  edit: GuiMenuItem[];
  view: GuiMenuItem[];
  tools: GuiMenuItem[];
  help: GuiMenuItem[];
}

/**
 * Menu item
 */
export interface GuiMenuItem {
  id: string;
  label: string;
  accelerator?: string;
  enabled?: boolean;
  visible?: boolean;
  checked?: boolean;
  type?: 'normal' | 'separator' | 'submenu' | 'checkbox' | 'radio';
  submenu?: GuiMenuItem[];
  click?: string;
}

/**
 * Tray menu configuration
 */
export interface GuiTrayConfig {
  tooltip: string;
  icon: string;
  menu: GuiMenuItem[];
}

/**
 * Electron window options (subset)
 */
export interface GuiWindowOptions {
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
  title: string;
  icon?: string;
  frame?: boolean;
  transparent?: boolean;
  resizable?: boolean;
  movable?: boolean;
  minimizable?: boolean;
  maximizable?: boolean;
  closable?: boolean;
  alwaysOnTop?: boolean;
  fullscreenable?: boolean;
  skipTaskbar?: boolean;
  show?: boolean;
}
