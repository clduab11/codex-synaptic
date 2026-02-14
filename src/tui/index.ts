/**
 * TUI Module Entry Point
 * 
 * Exports for the Ink-based Terminal User Interface.
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

export type {
  TuiAppProps,
  TuiContextValue,
  StartTuiOptions,
  TuiSnapshotProvider,
  TuiRuntimeSnapshot
} from './app.js';
