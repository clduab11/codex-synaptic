/**
 * GUI Module Entry Point
 * 
 * Exports for the Electron-based Graphical User Interface.
 * 
 * To use the GUI, install the required dependencies:
 *   npm install --save-dev electron
 *   npm install electron-store electron-updater
 */

// Types
export type {
  GuiWindowState,
  GuiTheme,
  GuiNavItem,
  GuiNotification,
  GuiAppState,
  GuiIpcChannel,
  GuiIpcMessage,
  GuiIpcResponse,
  GuiSystemStatus,
  GuiDashboardWidget,
  GuiChartDataPoint,
  GuiActivityEntry,
  GuiMenuConfig,
  GuiMenuItem,
  GuiTrayConfig,
  GuiWindowOptions,
} from './types.js';

// API Client
export {
  GuiApiClient,
  getApiClient,
  resetApiClient,
} from './api-client.js';

export type { ApiClientConfig } from './api-client.js';

// Main Process
export {
  GuiApplication,
  startGui,
} from './main.js';

export type { GuiStartOptions } from './main.js';
