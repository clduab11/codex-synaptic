/**
 * CLI Output Adapter
 * 
 * Renders output payloads to the command-line interface using
 * ANSI escape codes and traditional console output.
 */

import { createInterface } from 'readline';
import type { InterfaceMode } from '../core/config.js';
import type {
  AnyOutputPayload,
  AnyInputRequest,
  InputResponse,
  ProgressPayload,
  TextPayload,
  JsonPayload,
  TablePayload,
  TreePayload,
  TreeNode,
  ListPayload,
  CodePayload,
  MetricPayload,
  StatusPayload,
  RawPayload,
  SelectOption,
} from './contracts.js';
import { BaseOutputAdapter } from './output-adapter.js';

/**
 * ANSI color codes
 */
const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  
  // Foreground
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  
  // Background
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
} as const;

/**
 * Severity to color mapping
 */
const SEVERITY_COLORS = {
  info: COLORS.cyan,
  success: COLORS.green,
  warning: COLORS.yellow,
  error: COLORS.red,
  debug: COLORS.gray,
} as const;

/**
 * Status icons
 */
const STATUS_ICONS = {
  running: '⟳',
  success: '✓',
  failed: '✗',
  pending: '○',
  warning: '⚠',
} as const;

/**
 * Unicode fallbacks for non-unicode terminals
 */
const ASCII_STATUS_ICONS = {
  running: '*',
  success: '+',
  failed: 'x',
  pending: 'o',
  warning: '!',
} as const;

/**
 * CLI-specific output adapter
 */
export class CliOutputAdapter extends BaseOutputAdapter {
  readonly mode: InterfaceMode = 'cli';
  private progressLines: Map<string, number> = new Map();
  private lastProgressRender: number = 0;
  private readonly PROGRESS_THROTTLE_MS = 100;
  
  render(payload: AnyOutputPayload): void {
    switch (payload.type) {
      case 'text':
        this.renderText(payload);
        break;
      case 'json':
        this.renderJson(payload);
        break;
      case 'table':
        this.renderTable(payload);
        break;
      case 'progress':
        this.renderProgress(payload);
        break;
      case 'tree':
        this.renderTree(payload);
        break;
      case 'list':
        this.renderList(payload);
        break;
      case 'code':
        this.renderCode(payload);
        break;
      case 'metric':
        this.renderMetric(payload);
        break;
      case 'status':
        this.renderStatus(payload);
        break;
      case 'raw':
        this.renderRaw(payload);
        break;
    }
  }
  
  private renderText(payload: TextPayload): void {
    let output = payload.content;
    const ctx = this.getContext();
    
    if (ctx.colorSupport && payload.formatting) {
      const f = payload.formatting;
      if (f.bold) output = COLORS.bold + output;
      if (f.italic) output = COLORS.italic + output;
      if (f.color && f.color in COLORS) {
        output = (COLORS as any)[f.color] + output;
      }
      output += COLORS.reset;
    }
    
    if (payload.severity && ctx.colorSupport) {
      const prefix = SEVERITY_COLORS[payload.severity];
      output = prefix + output + COLORS.reset;
    }
    
    console.log(output);
  }
  
  private renderJson(payload: JsonPayload): void {
    const ctx = this.getContext();
    const indent = payload.pretty ? 2 : undefined;
    const json = JSON.stringify(payload.data, null, indent);
    
    if (ctx.colorSupport && payload.severity) {
      const color = SEVERITY_COLORS[payload.severity];
      console.log(color + json + COLORS.reset);
    } else {
      console.log(json);
    }
  }
  
  private renderTable(payload: TablePayload): void {
    const ctx = this.getContext();
    const { columns, rows, title, footer } = payload;
    
    // Calculate column widths
    const widths = columns.map((col) => {
      const labelWidth = col.label.length;
      const dataWidth = Math.max(
        ...rows.map((row) => String(row[col.key] ?? '').length)
      );
      return col.width ?? Math.max(labelWidth, dataWidth, 3);
    });
    
    const totalWidth = widths.reduce((sum, w) => sum + w + 3, 1);
    const divider = ctx.unicode ? '─'.repeat(totalWidth) : '-'.repeat(totalWidth);
    
    // Title
    if (title) {
      if (ctx.colorSupport) {
        console.log(COLORS.bold + title + COLORS.reset);
      } else {
        console.log(title);
      }
    }
    
    console.log(divider);
    
    // Header
    const headerLine = columns
      .map((col, i) => this.pad(col.label, widths[i], col.align ?? 'left'))
      .join(' | ');
    
    if (ctx.colorSupport) {
      console.log(COLORS.bold + '| ' + headerLine + ' |' + COLORS.reset);
    } else {
      console.log('| ' + headerLine + ' |');
    }
    
    console.log(divider);
    
    // Rows
    for (const row of rows) {
      const rowLine = columns
        .map((col, i) => {
          const value = col.formatter
            ? col.formatter(row[col.key])
            : String(row[col.key] ?? '');
          return this.pad(value, widths[i], col.align ?? 'left');
        })
        .join(' | ');
      
      console.log('| ' + rowLine + ' |');
    }
    
    console.log(divider);
    
    // Footer
    if (footer) {
      if (ctx.colorSupport) {
        console.log(COLORS.dim + footer + COLORS.reset);
      } else {
        console.log(footer);
      }
    }
  }
  
  private renderProgress(payload: ProgressPayload): void {
    this.progressTrackers.set(payload.id, payload);
    this.renderProgressBar(payload);
  }
  
  private renderProgressBar(progress: ProgressPayload): void {
    const now = Date.now();
    if (now - this.lastProgressRender < this.PROGRESS_THROTTLE_MS) {
      return;
    }
    this.lastProgressRender = now;
    
    const ctx = this.getContext();
    const { label, current, total, unit, showPercentage, showEta } = progress;
    
    const percent = Math.min(100, Math.round((current / total) * 100));
    const barWidth = Math.min(30, (ctx.width ?? 80) - 40);
    const filled = Math.round((percent / 100) * barWidth);
    const empty = barWidth - filled;
    
    let bar: string;
    if (ctx.unicode) {
      bar = '█'.repeat(filled) + '░'.repeat(empty);
    } else {
      bar = '#'.repeat(filled) + '-'.repeat(empty);
    }
    
    let line = `${label} [${bar}]`;
    
    if (showPercentage !== false) {
      line += ` ${percent}%`;
    }
    
    if (current !== undefined && total !== undefined) {
      const unitStr = unit ? ` ${unit}` : '';
      line += ` (${current}/${total}${unitStr})`;
    }
    
    if (showEta && progress.metadata?.eta) {
      line += ` ETA: ${progress.metadata.eta}`;
    }
    
    // For CLI, just print on new line (TUI would handle in-place updates)
    if (ctx.colorSupport) {
      console.log(COLORS.cyan + line + COLORS.reset);
    } else {
      console.log(line);
    }
  }
  
  protected renderProgressUpdate(progress: ProgressPayload): void {
    this.renderProgressBar(progress);
  }
  
  protected renderProgressComplete(
    progress: ProgressPayload,
    status: 'success' | 'error',
    message?: string
  ): void {
    const ctx = this.getContext();
    const icon = ctx.unicode
      ? (status === 'success' ? STATUS_ICONS.success : STATUS_ICONS.failed)
      : (status === 'success' ? ASCII_STATUS_ICONS.success : ASCII_STATUS_ICONS.failed);
    
    const color = status === 'success' ? COLORS.green : COLORS.red;
    const text = message ?? `${progress.label} ${status}`;
    
    if (ctx.colorSupport) {
      console.log(color + `${icon} ${text}` + COLORS.reset);
    } else {
      console.log(`${icon} ${text}`);
    }
  }
  
  private renderTree(payload: TreePayload): void {
    const ctx = this.getContext();
    const expandLevel = payload.expandLevel ?? Infinity;
    
    const renderNode = (node: TreeNode, prefix: string, isLast: boolean, depth: number) => {
      const connector = ctx.unicode
        ? (isLast ? '└── ' : '├── ')
        : (isLast ? '\\-- ' : '+-- ');
      
      const icon = node.icon ? `${node.icon} ` : '';
      const line = prefix + connector + icon + node.label;
      
      if (ctx.colorSupport && depth === 0) {
        console.log(COLORS.bold + line + COLORS.reset);
      } else {
        console.log(line);
      }
      
      if (node.children && depth < expandLevel) {
        const childPrefix = prefix + (ctx.unicode ? (isLast ? '    ' : '│   ') : (isLast ? '    ' : '|   '));
        node.children.forEach((child, index) => {
          renderNode(child, childPrefix, index === node.children!.length - 1, depth + 1);
        });
      }
    };
    
    const icon = payload.root.icon ? `${payload.root.icon} ` : '';
    if (ctx.colorSupport) {
      console.log(COLORS.bold + icon + payload.root.label + COLORS.reset);
    } else {
      console.log(icon + payload.root.label);
    }
    
    if (payload.root.children) {
      payload.root.children.forEach((child, index) => {
        renderNode(child, '', index === payload.root.children!.length - 1, 1);
      });
    }
  }
  
  private renderList(payload: ListPayload): void {
    const ctx = this.getContext();
    const { items, ordered, title } = payload;
    
    if (title) {
      if (ctx.colorSupport) {
        console.log(COLORS.bold + title + COLORS.reset);
      } else {
        console.log(title);
      }
    }
    
    items.forEach((item, index) => {
      const indent = '  '.repeat(item.indent ?? 0);
      let bullet: string;
      
      if (item.checked !== undefined) {
        bullet = ctx.unicode
          ? (item.checked ? '☑' : '☐')
          : (item.checked ? '[x]' : '[ ]');
      } else if (ordered) {
        bullet = `${index + 1}.`;
      } else {
        bullet = item.bullet ?? (ctx.unicode ? '•' : '-');
      }
      
      console.log(`${indent}${bullet} ${item.content}`);
    });
  }
  
  private renderCode(payload: CodePayload): void {
    const ctx = this.getContext();
    const { code, language, showLineNumbers, highlight } = payload;
    const lines = code.split('\n');
    
    if (language) {
      if (ctx.colorSupport) {
        console.log(COLORS.dim + `// ${language}` + COLORS.reset);
      } else {
        console.log(`// ${language}`);
      }
    }
    
    const lineNumWidth = showLineNumbers ? String(lines.length).length : 0;
    
    lines.forEach((line, index) => {
      const lineNum = index + 1;
      const isHighlighted = highlight?.includes(lineNum);
      
      let output = '';
      if (showLineNumbers) {
        const numStr = String(lineNum).padStart(lineNumWidth, ' ');
        output += ctx.colorSupport ? COLORS.dim + numStr + ' | ' + COLORS.reset : numStr + ' | ';
      }
      
      output += line;
      
      if (isHighlighted && ctx.colorSupport) {
        console.log(COLORS.bgYellow + COLORS.black + output + COLORS.reset);
      } else {
        console.log(output);
      }
    });
  }
  
  private renderMetric(payload: MetricPayload): void {
    const ctx = this.getContext();
    const { name, value, unit, trend, threshold } = payload;
    
    let output = `${name}: ${this.formatNumber(value)}`;
    if (unit) output += ` ${unit}`;
    
    if (trend && ctx.unicode) {
      const trendIcon = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→';
      output += ` ${trendIcon}`;
    }
    
    let color = '';
    if (ctx.colorSupport && threshold) {
      if (threshold.critical !== undefined && value >= threshold.critical) {
        color = COLORS.red;
      } else if (threshold.warning !== undefined && value >= threshold.warning) {
        color = COLORS.yellow;
      } else {
        color = COLORS.green;
      }
    }
    
    if (color) {
      console.log(color + output + COLORS.reset);
    } else {
      console.log(output);
    }
  }
  
  private renderStatus(payload: StatusPayload): void {
    const ctx = this.getContext();
    const { label, status, detail } = payload;
    
    const icon = ctx.unicode ? STATUS_ICONS[status] : ASCII_STATUS_ICONS[status];
    
    const statusColors: Record<string, string> = {
      running: COLORS.cyan,
      success: COLORS.green,
      failed: COLORS.red,
      pending: COLORS.gray,
      warning: COLORS.yellow,
    };
    
    let output = `${icon} ${label}`;
    if (detail) {
      output += ctx.colorSupport ? ` ${COLORS.dim}(${detail})${COLORS.reset}` : ` (${detail})`;
    }
    
    if (ctx.colorSupport) {
      console.log(statusColors[status] + output + COLORS.reset);
    } else {
      console.log(output);
    }
  }
  
  private renderRaw(payload: RawPayload): void {
    process.stdout.write(payload.content);
  }
  
  async prompt<T = unknown>(request: AnyInputRequest): Promise<InputResponse<T>> {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
    return new Promise((resolve) => {
      const cleanup = () => {
        rl.close();
      };
      
      const ctx = this.getContext();
      let promptText = request.label;
      
      if (request.hint) {
        promptText += ctx.colorSupport
          ? ` ${COLORS.dim}(${request.hint})${COLORS.reset}`
          : ` (${request.hint})`;
      }
      
      if (request.default !== undefined) {
        promptText += ` [${request.default}]`;
      }
      
      promptText += ': ';
      
      switch (request.type) {
        case 'text':
        case 'password':
        case 'number':
          rl.question(promptText, (answer) => {
            cleanup();
            
            let value: unknown = answer || request.default;
            
            if (request.type === 'number') {
              value = parseFloat(answer) || request.default;
            }
            
            resolve({
              id: request.id,
              value: value as T,
              cancelled: false,
            });
          });
          break;
          
        case 'confirm':
          rl.question(`${promptText} (y/n): `, (answer) => {
            cleanup();
            const normalized = answer.toLowerCase().trim();
            const value = normalized === 'y' || normalized === 'yes' || 
              (normalized === '' && request.default === true);
            
            resolve({
              id: request.id,
              value: value as T,
              cancelled: false,
            });
          });
          break;
          
        case 'select':
        case 'autocomplete': {
          const options = (request as any).options as SelectOption[];
          console.log(promptText);
          options.forEach((opt, index) => {
            const hint = opt.hint ? ` - ${opt.hint}` : '';
            const disabled = opt.disabled ? ' (disabled)' : '';
            console.log(`  ${index + 1}. ${opt.label}${hint}${disabled}`);
          });
          
          rl.question('Enter number: ', (answer) => {
            cleanup();
            const index = parseInt(answer, 10) - 1;
            
            if (index >= 0 && index < options.length && !options[index].disabled) {
              resolve({
                id: request.id,
                value: options[index].value as T,
                cancelled: false,
              });
            } else {
              resolve({
                id: request.id,
                value: (request.default ?? options[0]?.value) as T,
                cancelled: false,
              });
            }
          });
          break;
        }
          
        case 'multiselect': {
          const options = (request as any).options as SelectOption[];
          console.log(promptText);
          options.forEach((opt, index) => {
            console.log(`  ${index + 1}. ${opt.label}`);
          });
          
          rl.question('Enter numbers (comma-separated): ', (answer) => {
            cleanup();
            const indices = answer.split(',').map((s) => parseInt(s.trim(), 10) - 1);
            const values = indices
              .filter((i) => i >= 0 && i < options.length && !options[i].disabled)
              .map((i) => options[i].value);
            
            resolve({
              id: request.id,
              value: values as T,
              cancelled: false,
            });
          });
          break;
        }
          
        default:
          cleanup();
          resolve({
            id: request.id,
            value: request.default as T,
            cancelled: true,
          });
      }
    });
  }
  
  clear(): void {
    // Clear terminal screen
    process.stdout.write('\x1b[2J\x1b[H');
  }
}
