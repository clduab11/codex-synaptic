/**
 * TUI Application Entry Point
 * 
 * Main Ink application component for the Terminal User Interface.
 * This file provides the foundation for the React-based TUI.
 * 
 * Note: Ink must be installed as a dependency to use this module:
 *   npm install ink ink-select-input ink-text-input ink-spinner
 */

import React, { useReducer, useEffect, useCallback, useMemo } from 'react';
import type { FC } from 'react';
import type { InterfaceTier } from '../core/config.js';
import type {
  TuiState,
  TuiAction,
  TuiViewType,
  TuiPanel,
} from './types.js';
import { getTheme } from './themes.js';
import { getTuiAdapter } from './tui-adapter.js';

/**
 * Default panels configuration
 */
const defaultPanels: TuiPanel[] = [
  { id: 'sidebar', title: 'Navigation', visible: true, position: 'left', width: 20 },
  { id: 'main', title: 'Main', visible: true, position: 'center' },
  { id: 'status', title: 'Status', visible: true, position: 'bottom', height: 3 },
  { id: 'details', title: 'Details', visible: false, position: 'right', width: 30, minTier: 'intermediate' },
];

/**
 * Initial TUI state
 */
function createInitialState(tier: InterfaceTier): TuiState {
  return {
    navigation: {
      currentView: 'dashboard',
      breadcrumbs: ['Dashboard'],
      selectedIndex: 0,
      scrollOffset: 0,
    },
    theme: getTheme('dark'),
    tier,
    refreshInterval: 1000,
    showShortcuts: true,
    animations: true,
    panels: defaultPanels,
    pendingOutput: [],
    activeProgress: new Map(),
    connected: false,
    lastUpdate: new Date(),
  };
}

/**
 * TUI state reducer
 */
function tuiReducer(state: TuiState, action: TuiAction): TuiState {
  switch (action.type) {
    case 'NAVIGATE': {
      const viewLabels: Record<TuiViewType, string> = {
        dashboard: 'Dashboard',
        agents: 'Agents',
        tasks: 'Tasks',
        mesh: 'Neural Mesh',
        swarm: 'Swarm',
        consensus: 'Consensus',
        memory: 'Memory',
        settings: 'Settings',
        help: 'Help',
        logs: 'Logs',
      };
      
      return {
        ...state,
        navigation: {
          ...state.navigation,
          previousView: state.navigation.currentView,
          currentView: action.view,
          breadcrumbs: [viewLabels[action.view]],
          selectedIndex: 0,
          scrollOffset: 0,
        },
      };
    }
    
    case 'GO_BACK':
      if (state.navigation.previousView) {
        return tuiReducer(state, { type: 'NAVIGATE', view: state.navigation.previousView });
      }
      return state;
    
    case 'SET_THEME':
      return {
        ...state,
        theme: getTheme(action.theme),
      };
    
    case 'SET_TIER':
      return {
        ...state,
        tier: action.tier,
        panels: state.panels.map(panel => ({
          ...panel,
          visible: panel.minTier ? shouldShowForTier(action.tier, panel.minTier) : panel.visible,
        })),
      };
    
    case 'SET_REFRESH_INTERVAL':
      return {
        ...state,
        refreshInterval: action.interval,
      };
    
    case 'TOGGLE_SHORTCUTS':
      return {
        ...state,
        showShortcuts: !state.showShortcuts,
      };
    
    case 'TOGGLE_ANIMATIONS':
      return {
        ...state,
        animations: !state.animations,
      };
    
    case 'TOGGLE_PANEL': {
      return {
        ...state,
        panels: state.panels.map(panel =>
          panel.id === action.panelId
            ? { ...panel, visible: !panel.visible }
            : panel
        ),
      };
    }
    
    case 'ADD_OUTPUT':
      return {
        ...state,
        pendingOutput: [...state.pendingOutput, action.payload].slice(-100), // Keep last 100
        lastUpdate: new Date(),
      };
    
    case 'CLEAR_OUTPUT':
      return {
        ...state,
        pendingOutput: [],
      };
    
    case 'UPDATE_PROGRESS': {
      const newProgress = new Map(state.activeProgress);
      const existing = newProgress.get(action.id);
      if (existing) {
        newProgress.set(action.id, { ...existing, ...action.progress });
      }
      return {
        ...state,
        activeProgress: newProgress,
      };
    }
    
    case 'COMPLETE_PROGRESS': {
      const newProgress = new Map(state.activeProgress);
      newProgress.delete(action.id);
      return {
        ...state,
        activeProgress: newProgress,
      };
    }
    
    case 'SET_CONNECTED':
      return {
        ...state,
        connected: action.connected,
      };
    
    case 'SET_SELECTION':
      return {
        ...state,
        navigation: {
          ...state.navigation,
          selectedIndex: action.index,
        },
      };
    
    case 'SCROLL':
      return {
        ...state,
        navigation: {
          ...state.navigation,
          scrollOffset: action.offset,
        },
      };
    
    default:
      return state;
  }
}

/**
 * Check if content should be shown for tier
 */
function shouldShowForTier(current: InterfaceTier, minimum: InterfaceTier): boolean {
  const order: InterfaceTier[] = ['beginner', 'intermediate', 'advanced'];
  return order.indexOf(current) >= order.indexOf(minimum);
}

/**
 * Props for the TUI App
 */
export interface TuiAppProps {
  initialTier?: InterfaceTier;
  onExit?: () => void;
}

/**
 * TUI Context for sharing state with child components
 */
export interface TuiContextValue {
  state: TuiState;
  dispatch: (action: TuiAction) => void;
}

export const TuiContext = React.createContext<TuiContextValue | null>(null);

/**
 * Hook to use TUI context
 */
export function useTui(): TuiContextValue {
  const context = React.useContext(TuiContext);
  if (!context) {
    throw new Error('useTui must be used within TuiApp');
  }
  return context;
}

/**
 * Main TUI Application Component
 * 
 * This is a placeholder implementation. The full implementation
 * requires Ink to be installed and will include:
 * - Navigation sidebar
 * - Main content area with view routing
 * - Status bar
 * - Keyboard shortcuts
 * - Theme support
 */
export const TuiApp: FC<TuiAppProps> = ({ initialTier = 'intermediate', onExit }) => {
  const [state, dispatch] = useReducer(tuiReducer, initialTier, createInitialState);
  
  // Connect to the TUI adapter
  useEffect(() => {
    const adapter = getTuiAdapter();
    adapter.connectDispatcher(dispatch);
    
    // Set connected status
    dispatch({ type: 'SET_CONNECTED', connected: true });
    
    return () => {
      dispatch({ type: 'SET_CONNECTED', connected: false });
    };
  }, []);
  
  // Handle keyboard shortcuts
  const handleKeyPress = useCallback((key: string) => {
    switch (key) {
      case 'q':
        onExit?.();
        break;
      case 'd':
        dispatch({ type: 'NAVIGATE', view: 'dashboard' });
        break;
      case 'a':
        dispatch({ type: 'NAVIGATE', view: 'agents' });
        break;
      case 't':
        dispatch({ type: 'NAVIGATE', view: 'tasks' });
        break;
      case 'm':
        dispatch({ type: 'NAVIGATE', view: 'mesh' });
        break;
      case 's':
        dispatch({ type: 'NAVIGATE', view: 'swarm' });
        break;
      case 'c':
        dispatch({ type: 'NAVIGATE', view: 'consensus' });
        break;
      case '?':
        dispatch({ type: 'NAVIGATE', view: 'help' });
        break;
      case 'escape':
        dispatch({ type: 'GO_BACK' });
        break;
    }
  }, [onExit]);
  
  // Context value
  const contextValue = useMemo(() => ({ state, dispatch }), [state]);
  
  // Note: This is a placeholder. The actual rendering would use Ink components:
  // import { Box, Text, useInput } from 'ink';
  // 
  // return (
  //   <TuiContext.Provider value={contextValue}>
  //     <Box flexDirection="column" width="100%" height="100%">
  //       <Header />
  //       <Box flexGrow={1}>
  //         <Sidebar />
  //         <MainContent />
  //         {state.panels.find(p => p.id === 'details')?.visible && <DetailsPanel />}
  //       </Box>
  //       <StatusBar />
  //     </Box>
  //   </TuiContext.Provider>
  // );
  
  return React.createElement(
    TuiContext.Provider,
    { value: contextValue },
    React.createElement('div', { 
      'data-testid': 'tui-app',
      'data-view': state.navigation.currentView,
      'data-tier': state.tier,
      'data-connected': state.connected,
    },
      `Codex-Synaptic TUI - ${state.navigation.currentView} (${state.tier} tier)`
    )
  );
};

/**
 * Start the TUI application
 * 
 * This function would normally use Ink's render function:
 * import { render } from 'ink';
 * 
 * export async function startTui(options: TuiAppProps): Promise<void> {
 *   const { waitUntilExit } = render(<TuiApp {...options} />);
 *   await waitUntilExit();
 * }
 */
export async function startTui(options: TuiAppProps = {}): Promise<void> {
  // Placeholder implementation
  console.log('TUI mode requires Ink to be installed.');
  console.log('Install with: npm install ink ink-select-input ink-text-input');
  console.log('');
  console.log('Starting with fallback CLI mode...');
  
  // In a real implementation, this would render the Ink app
  const { onExit } = options;
  
  // Simulate TUI running
  return new Promise((resolve) => {
    const cleanup = () => {
      onExit?.();
      resolve();
    };
    
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    
    // Keep running until signal received
    console.log('Press Ctrl+C to exit.');
  });
}

export default TuiApp;
