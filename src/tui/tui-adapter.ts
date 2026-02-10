/**
 * TUI Output Adapter
 * 
 * Renders output payloads to the Ink-based Terminal User Interface.
 * This adapter bridges the rendering abstraction with the Ink React components.
 */

import { EventEmitter } from 'events';
import type { InterfaceMode } from '../core/config.js';
import type {
  AnyOutputPayload,
  AnyInputRequest,
  InputResponse,
  ProgressPayload,
} from '../rendering/contracts.js';
import { BaseOutputAdapter } from '../rendering/output-adapter.js';
import type { TuiState, TuiAction } from './types.js';

/**
 * TUI-specific output adapter
 * 
 * Instead of directly rendering to console, this adapter
 * emits events that the Ink app subscribes to for rendering.
 */
export class TuiOutputAdapter extends BaseOutputAdapter {
  readonly mode: InterfaceMode = 'tui';
  private emitter: EventEmitter;
  private stateDispatch?: (action: TuiAction) => void;
  
  constructor() {
    super();
    this.emitter = new EventEmitter();
  }
  
  /**
   * Connect the adapter to the TUI state dispatcher
   */
  connectDispatcher(dispatch: (action: TuiAction) => void): void {
    this.stateDispatch = dispatch;
  }
  
  /**
   * Subscribe to output events
   */
  onOutput(handler: (payload: AnyOutputPayload) => void): () => void {
    this.emitter.on('output', handler);
    return () => this.emitter.off('output', handler);
  }
  
  /**
   * Subscribe to input request events
   */
  onInputRequest(handler: (request: AnyInputRequest, respond: (response: InputResponse) => void) => void): () => void {
    this.emitter.on('input', handler);
    return () => this.emitter.off('input', handler);
  }
  
  /**
   * Subscribe to clear events
   */
  onClear(handler: () => void): () => void {
    this.emitter.on('clear', handler);
    return () => this.emitter.off('clear', handler);
  }
  
  render(payload: AnyOutputPayload): void {
    // Emit for event subscribers
    this.emitter.emit('output', payload);
    
    // Dispatch to TUI state if connected
    if (this.stateDispatch) {
      this.stateDispatch({ type: 'ADD_OUTPUT', payload });
    }
    
    // Handle progress payloads specially
    if (payload.type === 'progress') {
      this.progressTrackers.set(payload.id, payload);
    }
  }
  
  protected renderProgressUpdate(progress: ProgressPayload): void {
    this.emitter.emit('progress', progress);
    
    if (this.stateDispatch) {
      this.stateDispatch({
        type: 'UPDATE_PROGRESS',
        id: progress.id,
        progress,
      });
    }
  }
  
  protected renderProgressComplete(
    progress: ProgressPayload,
    status: 'success' | 'error',
    message?: string
  ): void {
    this.emitter.emit('progressComplete', { progress, status, message });
    
    if (this.stateDispatch) {
      this.stateDispatch({ type: 'COMPLETE_PROGRESS', id: progress.id });
    }
  }
  
  async prompt<T = unknown>(request: AnyInputRequest): Promise<InputResponse<T>> {
    return new Promise((resolve) => {
      const respond = (response: InputResponse) => {
        resolve(response as InputResponse<T>);
      };
      
      this.emitter.emit('input', request, respond);
    });
  }
  
  clear(): void {
    this.emitter.emit('clear');
    
    if (this.stateDispatch) {
      this.stateDispatch({ type: 'CLEAR_OUTPUT' });
    }
  }
  
  protected onDispose(): void {
    this.emitter.removeAllListeners();
    this.stateDispatch = undefined;
  }
}

/**
 * Singleton instance for the TUI adapter
 */
let tuiAdapterInstance: TuiOutputAdapter | null = null;

/**
 * Get or create the TUI adapter instance
 */
export function getTuiAdapter(): TuiOutputAdapter {
  if (!tuiAdapterInstance) {
    tuiAdapterInstance = new TuiOutputAdapter();
  }
  return tuiAdapterInstance;
}

/**
 * Reset the TUI adapter (mainly for testing)
 */
export function resetTuiAdapter(): void {
  if (tuiAdapterInstance) {
    tuiAdapterInstance.dispose();
    tuiAdapterInstance = null;
  }
}
