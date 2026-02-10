/**
 * TUI Module Entry Point
 * 
 * Exports for the Ink-based Terminal User Interface.
 * 
 * To use the TUI, install the required dependencies:
 *   npm install ink ink-select-input ink-text-input ink-spinner react
 */

// Types
export type {
  TuiTheme,
  TuiNavigationState,
  TuiViewType,
  TuiShortcut,
  TuiPanel,
  TuiState,
  TuiAction,
  DashboardWidget,
  AgentDisplayData,
  TaskDisplayData,
  MeshNodeDisplayData,
  SwarmDisplayData,
  ConsensusDisplayData,
  MemoryDisplayData,
  LogDisplayData,
} from './types.js';

// Themes
export {
  darkTheme,
  lightTheme,
  highContrastTheme,
  getTheme,
  themeNames,
} from './themes.js';

// Adapter
export {
  TuiOutputAdapter,
  getTuiAdapter,
  resetTuiAdapter,
} from './tui-adapter.js';

// App (requires ink to be installed)
export {
  TuiApp,
  TuiContext,
  useTui,
  startTui,
} from './app.js';

export type { TuiAppProps, TuiContextValue } from './app.js';
