/**
 * Rendering Abstraction Layer
 * 
 * This module provides a unified interface for rendering output across
 * CLI, TUI, and GUI modes with tier-based progressive disclosure.
 */

// Core contracts and types
export type {
  OutputSeverity,
  OutputContentType,
  OutputPayload,
  TextPayload,
  JsonPayload,
  TableColumn,
  TablePayload,
  ProgressPayload,
  TreeNode,
  TreePayload,
  ListItem,
  ListPayload,
  CodePayload,
  MetricPayload,
  StatusPayload,
  RawPayload,
  AnyOutputPayload,
  InputType,
  SelectOption,
  InputRequest,
  TextInputRequest,
  PasswordInputRequest,
  NumberInputRequest,
  SelectInputRequest,
  MultiSelectInputRequest,
  ConfirmInputRequest,
  AutocompleteInputRequest,
  AnyInputRequest,
  InputResponse,
  RenderContext,
  OutputAdapter,
  OutputTransformer,
  RenderingEvents,
  RenderingManager,
} from './contracts.js';

// Base adapter
export { BaseOutputAdapter } from './output-adapter.js';

// CLI adapter
export { CliOutputAdapter } from './cli-adapter.js';

// Transformers
export {
  createTierTransformer,
  createTableSimplifier,
  createTreeDepthLimiter,
  createColorStripper,
  createUnicodeFallback,
  createWidthConstrainer,
  createSeverityFilter,
  createMetricThresholdEnhancer,
  createTimestampFormatter,
  composeTransformers,
  createCliTransformerPipeline,
  createTuiTransformerPipeline,
  createGuiTransformerPipeline,
} from './transformers.js';
