/**
 * Output Transformers
 * 
 * Provides transformation functions that modify output payloads
 * based on render context (mode, tier, capabilities).
 */

import type { InterfaceTier } from '../core/config.js';
import type {
  OutputTransformer,
  AnyOutputPayload,
  RenderContext,
  TablePayload,
  TreePayload,
  ListPayload,
  CodePayload,
  MetricPayload,
} from './contracts.js';

/**
 * Tier-based visibility transformer
 * Filters out content that's not appropriate for the current tier
 */
export function createTierTransformer(): OutputTransformer {
  return (payload: AnyOutputPayload, context: RenderContext): AnyOutputPayload => {
    const tier = context.tier;
    const metadata = payload.metadata as { minTier?: InterfaceTier } | undefined;
    
    // Check minimum tier requirement
    if (metadata?.minTier) {
      const tierOrder: InterfaceTier[] = ['beginner', 'intermediate', 'advanced'];
      const currentIdx = tierOrder.indexOf(tier);
      const minIdx = tierOrder.indexOf(metadata.minTier);
      
      if (currentIdx < minIdx) {
        // Return empty text payload for content that shouldn't be shown
        return {
          type: 'text',
          content: '',
          metadata: { hidden: true },
        };
      }
    }
    
    return payload;
  };
}

/**
 * Table simplification transformer for beginner tier
 * Reduces complex tables to simpler formats
 */
export function createTableSimplifier(): OutputTransformer {
  return (payload: AnyOutputPayload, context: RenderContext): AnyOutputPayload => {
    if (payload.type !== 'table' || context.tier !== 'beginner') {
      return payload;
    }
    
    const tablePayload = payload as TablePayload;
    
    // For beginners, limit columns to essential ones (first 3-4)
    const maxColumns = 4;
    if (tablePayload.columns.length > maxColumns) {
      return {
        ...tablePayload,
        columns: tablePayload.columns.slice(0, maxColumns),
        metadata: {
          ...tablePayload.metadata,
          truncated: true,
          originalColumnCount: tablePayload.columns.length,
        },
      };
    }
    
    return payload;
  };
}

/**
 * Tree depth limiter transformer
 * Limits tree expansion for simpler views
 */
export function createTreeDepthLimiter(maxDepthByTier: Record<InterfaceTier, number>): OutputTransformer {
  return (payload: AnyOutputPayload, context: RenderContext): AnyOutputPayload => {
    if (payload.type !== 'tree') {
      return payload;
    }
    
    const treePayload = payload as TreePayload;
    const maxDepth = maxDepthByTier[context.tier] ?? Infinity;
    
    // Apply expandLevel if not already set or if it's higher than tier allows
    if (treePayload.expandLevel === undefined || treePayload.expandLevel > maxDepth) {
      return {
        ...treePayload,
        expandLevel: maxDepth,
      };
    }
    
    return payload;
  };
}

/**
 * Color stripping transformer for non-color terminals
 */
export function createColorStripper(): OutputTransformer {
  return (payload: AnyOutputPayload, context: RenderContext): AnyOutputPayload => {
    if (context.colorSupport) {
      return payload;
    }
    
    // Strip formatting from text payloads
    if (payload.type === 'text' && payload.formatting) {
      return {
        ...payload,
        formatting: undefined,
      };
    }
    
    return payload;
  };
}

/**
 * Unicode fallback transformer
 * Replaces unicode characters with ASCII equivalents
 */
export function createUnicodeFallback(): OutputTransformer {
  const unicodeMap: Record<string, string> = {
    '✓': '+',
    '✗': 'x',
    '⚠': '!',
    '•': '-',
    '→': '->',
    '←': '<-',
    '↑': '^',
    '↓': 'v',
    '│': '|',
    '─': '-',
    '└': '\\',
    '├': '+',
    '█': '#',
    '░': '.',
    '☑': '[x]',
    '☐': '[ ]',
    '○': 'o',
    '●': '*',
    '⟳': '*',
  };
  
  const replaceUnicode = (text: string): string => {
    let result = text;
    for (const [unicode, ascii] of Object.entries(unicodeMap)) {
      result = result.split(unicode).join(ascii);
    }
    return result;
  };
  
  return (payload: AnyOutputPayload, context: RenderContext): AnyOutputPayload => {
    if (context.unicode) {
      return payload;
    }
    
    switch (payload.type) {
      case 'text':
        return { ...payload, content: replaceUnicode(payload.content) };
        
      case 'list': {
        const listPayload = payload as ListPayload;
        return {
          ...listPayload,
          items: listPayload.items.map((item) => ({
            ...item,
            content: replaceUnicode(item.content),
            bullet: item.bullet ? replaceUnicode(item.bullet) : undefined,
          })),
        };
      }
        
      case 'tree': {
        const treePayload = payload as TreePayload;
        const transformNode = (node: typeof treePayload.root): typeof node => ({
          ...node,
          label: replaceUnicode(node.label),
          icon: node.icon ? replaceUnicode(node.icon) : undefined,
          children: node.children?.map(transformNode),
        });
        return {
          ...treePayload,
          root: transformNode(treePayload.root),
        };
      }
        
      default:
        return payload;
    }
  };
}

/**
 * Width constraint transformer
 * Truncates content to fit terminal width
 */
export function createWidthConstrainer(): OutputTransformer {
  return (payload: AnyOutputPayload, context: RenderContext): AnyOutputPayload => {
    const width = context.width ?? 80;
    
    if (payload.type === 'text' && payload.content.length > width) {
      return {
        ...payload,
        content: payload.content.slice(0, width - 3) + '...',
        metadata: {
          ...payload.metadata,
          truncated: true,
          originalLength: payload.content.length,
        },
      };
    }
    
    if (payload.type === 'code') {
      const codePayload = payload as CodePayload;
      const lines = codePayload.code.split('\n');
      const truncatedLines = lines.map((line) =>
        line.length > width ? line.slice(0, width - 3) + '...' : line
      );
      
      return {
        ...codePayload,
        code: truncatedLines.join('\n'),
      };
    }
    
    return payload;
  };
}

/**
 * Severity filter transformer
 * Filters out debug messages in non-advanced tiers
 */
export function createSeverityFilter(): OutputTransformer {
  return (payload: AnyOutputPayload, context: RenderContext): AnyOutputPayload => {
    if (!payload.severity) {
      return payload;
    }
    
    // Only show debug messages for advanced tier
    if (payload.severity === 'debug' && context.tier !== 'advanced') {
      return {
        type: 'text',
        content: '',
        metadata: { hidden: true },
      };
    }
    
    return payload;
  };
}

/**
 * Metric threshold enhancer
 * Adds warnings/errors based on threshold configuration
 */
export function createMetricThresholdEnhancer(): OutputTransformer {
  return (payload: AnyOutputPayload, context: RenderContext): AnyOutputPayload => {
    if (payload.type !== 'metric') {
      return payload;
    }
    
    const metricPayload = payload as MetricPayload;
    const { value, threshold } = metricPayload;
    
    if (!threshold) {
      return payload;
    }
    
    let severity = payload.severity;
    
    if (threshold.critical !== undefined && value >= threshold.critical) {
      severity = 'error';
    } else if (threshold.warning !== undefined && value >= threshold.warning) {
      severity = 'warning';
    }
    
    if (severity !== payload.severity) {
      return { ...metricPayload, severity };
    }
    
    return payload;
  };
}

/**
 * Timestamp formatter transformer
 * Adds human-readable timestamps to payloads
 */
export function createTimestampFormatter(
  format: 'relative' | 'absolute' | 'iso' = 'relative'
): OutputTransformer {
  const formatTimestamp = (date: Date): string => {
    switch (format) {
      case 'iso':
        return date.toISOString();
        
      case 'absolute':
        return date.toLocaleString();
        
      case 'relative': {
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        
        if (diffMs < 1000) return 'just now';
        if (diffMs < 60000) return `${Math.floor(diffMs / 1000)}s ago`;
        if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
        if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`;
        return `${Math.floor(diffMs / 86400000)}d ago`;
      }
    }
  };
  
  return (payload: AnyOutputPayload, _context: RenderContext): AnyOutputPayload => {
    if (payload.timestamp) {
      return {
        ...payload,
        metadata: {
          ...payload.metadata,
          formattedTimestamp: formatTimestamp(payload.timestamp),
        },
      };
    }
    
    return payload;
  };
}

/**
 * Compose multiple transformers into a single transformer
 */
export function composeTransformers(...transformers: OutputTransformer[]): OutputTransformer {
  return (payload: AnyOutputPayload, context: RenderContext): AnyOutputPayload => {
    return transformers.reduce(
      (currentPayload, transformer) => transformer(currentPayload, context),
      payload
    );
  };
}

/**
 * Create a standard transformer pipeline for the CLI
 */
export function createCliTransformerPipeline(): OutputTransformer {
  return composeTransformers(
    createTierTransformer(),
    createSeverityFilter(),
    createTableSimplifier(),
    createTreeDepthLimiter({ beginner: 2, intermediate: 4, advanced: Infinity }),
    createColorStripper(),
    createUnicodeFallback(),
    createWidthConstrainer(),
    createMetricThresholdEnhancer(),
    createTimestampFormatter('relative')
  );
}

/**
 * Create a standard transformer pipeline for the TUI
 */
export function createTuiTransformerPipeline(): OutputTransformer {
  return composeTransformers(
    createTierTransformer(),
    createSeverityFilter(),
    createMetricThresholdEnhancer(),
    createTimestampFormatter('relative')
  );
}

/**
 * Create a standard transformer pipeline for the GUI
 */
export function createGuiTransformerPipeline(): OutputTransformer {
  return composeTransformers(
    createTierTransformer(),
    createMetricThresholdEnhancer(),
    createTimestampFormatter('absolute')
  );
}
