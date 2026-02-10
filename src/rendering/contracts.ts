/**
 * Rendering Abstraction Layer - Core Contracts
 * 
 * This module defines the interfaces and types for the rendering abstraction
 * that enables CLI, TUI, and GUI outputs from a single data source.
 */

import type { InterfaceMode, InterfaceTier } from '../core/config.js';

/**
 * Severity levels for output messages
 */
export type OutputSeverity = 'info' | 'success' | 'warning' | 'error' | 'debug';

/**
 * Output content types
 */
export type OutputContentType = 
  | 'text'
  | 'json'
  | 'table'
  | 'progress'
  | 'tree'
  | 'list'
  | 'code'
  | 'metric'
  | 'status'
  | 'raw';

/**
 * Base output payload interface
 */
export interface OutputPayload {
  type: OutputContentType;
  severity?: OutputSeverity;
  timestamp?: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Text output payload
 */
export interface TextPayload extends OutputPayload {
  type: 'text';
  content: string;
  formatting?: {
    bold?: boolean;
    italic?: boolean;
    color?: string;
    background?: string;
  };
}

/**
 * JSON output payload
 */
export interface JsonPayload extends OutputPayload {
  type: 'json';
  data: unknown;
  pretty?: boolean;
}

/**
 * Table column definition
 */
export interface TableColumn {
  key: string;
  label: string;
  width?: number;
  align?: 'left' | 'center' | 'right';
  formatter?: (value: unknown) => string;
}

/**
 * Table output payload
 */
export interface TablePayload extends OutputPayload {
  type: 'table';
  columns: TableColumn[];
  rows: Record<string, unknown>[];
  title?: string;
  footer?: string;
}

/**
 * Progress output payload
 */
export interface ProgressPayload extends OutputPayload {
  type: 'progress';
  id: string;
  label: string;
  current: number;
  total: number;
  unit?: string;
  showPercentage?: boolean;
  showEta?: boolean;
}

/**
 * Tree node for hierarchical display
 */
export interface TreeNode {
  label: string;
  children?: TreeNode[];
  icon?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Tree output payload
 */
export interface TreePayload extends OutputPayload {
  type: 'tree';
  root: TreeNode;
  expandLevel?: number;
}

/**
 * List item
 */
export interface ListItem {
  content: string;
  indent?: number;
  bullet?: string;
  checked?: boolean;
}

/**
 * List output payload
 */
export interface ListPayload extends OutputPayload {
  type: 'list';
  items: ListItem[];
  ordered?: boolean;
  title?: string;
}

/**
 * Code output payload
 */
export interface CodePayload extends OutputPayload {
  type: 'code';
  code: string;
  language?: string;
  highlight?: number[];
  showLineNumbers?: boolean;
}

/**
 * Metric display payload
 */
export interface MetricPayload extends OutputPayload {
  type: 'metric';
  name: string;
  value: number;
  unit?: string;
  trend?: 'up' | 'down' | 'stable';
  threshold?: {
    warning?: number;
    critical?: number;
  };
}

/**
 * Status indicator payload
 */
export interface StatusPayload extends OutputPayload {
  type: 'status';
  label: string;
  status: 'running' | 'success' | 'failed' | 'pending' | 'warning';
  detail?: string;
}

/**
 * Raw output payload (passthrough)
 */
export interface RawPayload extends OutputPayload {
  type: 'raw';
  content: string;
}

/**
 * Union type of all output payloads
 */
export type AnyOutputPayload =
  | TextPayload
  | JsonPayload
  | TablePayload
  | ProgressPayload
  | TreePayload
  | ListPayload
  | CodePayload
  | MetricPayload
  | StatusPayload
  | RawPayload;

/**
 * Input types for interactive prompts
 */
export type InputType = 
  | 'text'
  | 'password'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'confirm'
  | 'autocomplete';

/**
 * Select option for choice inputs
 */
export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

/**
 * Base input request interface
 */
export interface InputRequest {
  type: InputType;
  id: string;
  label: string;
  hint?: string;
  required?: boolean;
  default?: unknown;
}

/**
 * Text input request
 */
export interface TextInputRequest extends InputRequest {
  type: 'text';
  placeholder?: string;
  maxLength?: number;
  validate?: (value: string) => string | true;
}

/**
 * Password input request
 */
export interface PasswordInputRequest extends InputRequest {
  type: 'password';
  mask?: string;
}

/**
 * Number input request
 */
export interface NumberInputRequest extends InputRequest {
  type: 'number';
  min?: number;
  max?: number;
  step?: number;
}

/**
 * Select input request
 */
export interface SelectInputRequest extends InputRequest {
  type: 'select';
  options: SelectOption[];
}

/**
 * Multi-select input request
 */
export interface MultiSelectInputRequest extends InputRequest {
  type: 'multiselect';
  options: SelectOption[];
  maxSelections?: number;
}

/**
 * Confirm input request
 */
export interface ConfirmInputRequest extends InputRequest {
  type: 'confirm';
  default?: boolean;
}

/**
 * Autocomplete input request
 */
export interface AutocompleteInputRequest extends InputRequest {
  type: 'autocomplete';
  options: SelectOption[];
  filterFn?: (input: string, option: SelectOption) => boolean;
}

/**
 * Union type of all input requests
 */
export type AnyInputRequest =
  | TextInputRequest
  | PasswordInputRequest
  | NumberInputRequest
  | SelectInputRequest
  | MultiSelectInputRequest
  | ConfirmInputRequest
  | AutocompleteInputRequest;

/**
 * Input response with typed value
 */
export interface InputResponse<T = unknown> {
  id: string;
  value: T;
  cancelled?: boolean;
}

/**
 * Rendering context passed to adapters
 */
export interface RenderContext {
  mode: InterfaceMode;
  tier: InterfaceTier;
  colorSupport: boolean;
  unicode: boolean;
  width?: number;
  height?: number;
}

/**
 * Output adapter interface - the main rendering abstraction
 */
export interface OutputAdapter {
  /**
   * Get the adapter's supported interface mode
   */
  readonly mode: InterfaceMode;
  
  /**
   * Initialize the adapter
   */
  initialize(context: RenderContext): Promise<void>;
  
  /**
   * Render an output payload
   */
  render(payload: AnyOutputPayload): void;
  
  /**
   * Render multiple payloads in sequence
   */
  renderBatch(payloads: AnyOutputPayload[]): void;
  
  /**
   * Request user input
   */
  prompt<T = unknown>(request: AnyInputRequest): Promise<InputResponse<T>>;
  
  /**
   * Clear the output area
   */
  clear(): void;
  
  /**
   * Update a progress indicator by ID
   */
  updateProgress(id: string, update: Partial<ProgressPayload>): void;
  
  /**
   * Complete and remove a progress indicator
   */
  completeProgress(id: string, status: 'success' | 'error', message?: string): void;
  
  /**
   * Clean up resources
   */
  dispose(): void;
}

/**
 * Output transformer function type
 */
export type OutputTransformer = (
  payload: AnyOutputPayload,
  context: RenderContext
) => AnyOutputPayload;

/**
 * Events emitted by the rendering system
 */
export interface RenderingEvents {
  'render': { payload: AnyOutputPayload; context: RenderContext };
  'input': { request: AnyInputRequest; context: RenderContext };
  'inputComplete': { response: InputResponse };
  'error': { error: Error; context: RenderContext };
  'modeSwitch': { from: InterfaceMode; to: InterfaceMode };
}

/**
 * Rendering manager interface for coordinating adapters
 */
export interface RenderingManager {
  /**
   * Get the current render context
   */
  getContext(): RenderContext;
  
  /**
   * Get the active output adapter
   */
  getAdapter(): OutputAdapter;
  
  /**
   * Switch to a different interface mode
   */
  switchMode(mode: InterfaceMode): Promise<void>;
  
  /**
   * Register a custom adapter
   */
  registerAdapter(mode: InterfaceMode, adapter: OutputAdapter): void;
  
  /**
   * Add a global output transformer
   */
  addTransformer(transformer: OutputTransformer): void;
  
  /**
   * Remove a transformer
   */
  removeTransformer(transformer: OutputTransformer): void;
  
  /**
   * Render output through the active adapter
   */
  render(payload: AnyOutputPayload): void;
  
  /**
   * Request input through the active adapter
   */
  prompt<T = unknown>(request: AnyInputRequest): Promise<InputResponse<T>>;
}
