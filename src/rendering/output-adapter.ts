/**
 * Base Output Adapter
 * 
 * Provides a foundation for interface-specific output adapters
 * with common functionality and default implementations.
 */

import type { InterfaceMode } from '../core/config.js';
import type {
  OutputAdapter,
  AnyOutputPayload,
  AnyInputRequest,
  InputResponse,
  RenderContext,
  ProgressPayload,
} from './contracts.js';

/**
 * Abstract base class for output adapters
 */
export abstract class BaseOutputAdapter implements OutputAdapter {
  protected context: RenderContext | null = null;
  protected progressTrackers: Map<string, ProgressPayload> = new Map();
  
  abstract readonly mode: InterfaceMode;
  
  async initialize(context: RenderContext): Promise<void> {
    this.context = context;
    await this.onInitialize();
  }
  
  /**
   * Hook for subclasses to perform additional initialization
   */
  protected async onInitialize(): Promise<void> {
    // Default: no-op
  }
  
  abstract render(payload: AnyOutputPayload): void;
  
  renderBatch(payloads: AnyOutputPayload[]): void {
    for (const payload of payloads) {
      this.render(payload);
    }
  }
  
  abstract prompt<T = unknown>(request: AnyInputRequest): Promise<InputResponse<T>>;
  
  abstract clear(): void;
  
  updateProgress(id: string, update: Partial<ProgressPayload>): void {
    const existing = this.progressTrackers.get(id);
    if (existing) {
      const updated = { ...existing, ...update };
      this.progressTrackers.set(id, updated);
      this.renderProgressUpdate(updated);
    }
  }
  
  completeProgress(id: string, status: 'success' | 'error', message?: string): void {
    const existing = this.progressTrackers.get(id);
    if (existing) {
      this.progressTrackers.delete(id);
      this.renderProgressComplete(existing, status, message);
    }
  }
  
  /**
   * Render a progress update - to be implemented by subclasses
   */
  protected abstract renderProgressUpdate(progress: ProgressPayload): void;
  
  /**
   * Render progress completion - to be implemented by subclasses
   */
  protected abstract renderProgressComplete(
    progress: ProgressPayload,
    status: 'success' | 'error',
    message?: string
  ): void;
  
  dispose(): void {
    this.progressTrackers.clear();
    this.context = null;
    this.onDispose();
  }
  
  /**
   * Hook for subclasses to perform additional cleanup
   */
  protected onDispose(): void {
    // Default: no-op
  }
  
  /**
   * Get the current render context
   */
  protected getContext(): RenderContext {
    if (!this.context) {
      throw new Error('Adapter not initialized - call initialize() first');
    }
    return this.context;
  }
  
  /**
   * Check if a feature should be shown based on tier
   */
  protected shouldShowForTier(minTier: 'beginner' | 'intermediate' | 'advanced'): boolean {
    const ctx = this.getContext();
    const tierOrder = ['beginner', 'intermediate', 'advanced'];
    const currentIdx = tierOrder.indexOf(ctx.tier);
    const minIdx = tierOrder.indexOf(minTier);
    return currentIdx >= minIdx;
  }
  
  /**
   * Format a number with appropriate precision
   */
  protected formatNumber(value: number, decimals = 2): string {
    if (Number.isInteger(value)) {
      return value.toString();
    }
    return value.toFixed(decimals);
  }
  
  /**
   * Format bytes to human-readable string
   */
  protected formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let unitIndex = 0;
    let value = bytes;
    
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }
    
    return `${this.formatNumber(value)} ${units[unitIndex]}`;
  }
  
  /**
   * Format duration in milliseconds to human-readable string
   */
  protected formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    }
    if (ms < 60000) {
      return `${this.formatNumber(ms / 1000)}s`;
    }
    if (ms < 3600000) {
      const minutes = Math.floor(ms / 60000);
      const seconds = Math.floor((ms % 60000) / 1000);
      return `${minutes}m ${seconds}s`;
    }
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
  }
  
  /**
   * Truncate text to fit within a width
   */
  protected truncate(text: string, maxWidth: number, ellipsis = '...'): string {
    if (text.length <= maxWidth) {
      return text;
    }
    return text.slice(0, maxWidth - ellipsis.length) + ellipsis;
  }
  
  /**
   * Pad text to a specific width
   */
  protected pad(text: string, width: number, align: 'left' | 'center' | 'right' = 'left'): string {
    if (text.length >= width) {
      return text;
    }
    
    const padding = width - text.length;
    
    switch (align) {
      case 'right':
        return ' '.repeat(padding) + text;
      case 'center': {
        const left = Math.floor(padding / 2);
        const right = padding - left;
        return ' '.repeat(left) + text + ' '.repeat(right);
      }
      default:
        return text + ' '.repeat(padding);
    }
  }
}
