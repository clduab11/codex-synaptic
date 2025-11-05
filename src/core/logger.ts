/**
 * Centralized logging system for Codex-Synaptic
 */

import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4
}

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  component: string;
  message: string;
  data?: any;
  error?: Error;
}

export class Logger {
  private static instance: Logger;
  private writers: Map<string, NodeJS.WritableStream> = new Map();
  private logLevel: LogLevel = LogLevel.INFO;
  private consoleLevel: LogLevel = LogLevel.INFO;
  private logDir = join(process.cwd(), 'logs');
  private listeners: Set<(entry: LogEntry) => void> = new Set();

  private constructor() {
    // Ensure log directory exists
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }

  static getInstance(_component?: string): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  setConsoleLevel(level: LogLevel): void {
    this.consoleLevel = level;
  }

  addListener(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  clearListeners(): void {
    this.listeners.clear();
  }

  getConsoleLevel(): LogLevel {
    return this.consoleLevel;
  }

  private getWriter(component: string): NodeJS.WritableStream {
    if (!this.writers.has(component)) {
      const logFile = join(this.logDir, `${component}.log`);
      const writer = createWriteStream(logFile, { flags: 'a' });
      this.writers.set(component, writer);
    }
    return this.writers.get(component)!;
  }

  private log(level: LogLevel, component: string, message: string, data?: any, error?: Error): void {
    if (level < this.logLevel) return;

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      component,
      message,
      data,
      error
    };

    const rawLine = this.formatEntryRaw(entry);
    const consoleLine = this.formatEntryConsole(entry);

    // Console output with vibes
    this.outputToConsole(entry, consoleLine);

    // File output retains structured format
    const writer = this.getWriter(component);
    writer.write(rawLine + '\n');

    // Also write to main log
    const mainWriter = this.getWriter('main');
    mainWriter.write(rawLine + '\n');

    if (this.listeners.size) {
      for (const listener of Array.from(this.listeners)) {
        try {
          listener(entry);
        } catch {
          // Listener errors should not disrupt logging pipeline
        }
      }
    }
  }

  private formatEntryRaw(entry: LogEntry): string {
    const timestamp = entry.timestamp.toISOString();
    const level = LogLevel[entry.level].padEnd(5);
    const component = entry.component.padEnd(12);
    
    let line = `[${timestamp}] ${level} ${component} ${entry.message}`;
    
    if (entry.data) {
      line += ` | Data: ${JSON.stringify(entry.data)}`;
    }
    
    if (entry.error) {
      line += ` | Error: ${entry.error.message}`;
      if (entry.error.stack) {
        line += ` | Stack: ${entry.error.stack}`;
      }
    }
    
    return line;
  }

  private formatEntryConsole(entry: LogEntry): string {
    const timestamp = chalk.gray(entry.timestamp.toISOString());
    const levelTag = this.getLevelTag(entry.level);
    const componentTag = chalk.cyan(`[${entry.component}]`);
    const message = chalk.white(entry.message);

    const details: string[] = [];

    const vibe = this.getLevelVibe(entry.level);
    if (vibe) {
      details.push(chalk.gray(vibe));
    }

    if (entry.data) {
      details.push(this.formatDataForConsole(entry.data));
    }

    if (entry.error) {
      details.push(chalk.redBright(`issue: ${entry.error.message}`));
      if (entry.error.stack) {
        details.push(chalk.dim(entry.error.stack));
      }
    }

    const detailText = details.length ? ` ${chalk.gray('~')} ${details.join(` ${chalk.gray('|')} `)}` : '';

    return `${timestamp} ${levelTag} ${componentTag} ${message}${detailText}`;
  }

  private getLevelTag(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG:
        return chalk.magenta('🛠  DEBUG');
      case LogLevel.INFO:
        return chalk.blueBright('✨ INFO');
      case LogLevel.WARN:
        return chalk.hex('#FFC107')('⚠️  WARN');
      case LogLevel.ERROR:
        return chalk.redBright('💥 ERROR');
      case LogLevel.FATAL:
        return chalk.bgRed.white('☠️  FATAL');
      default:
        return chalk.white(LogLevel[level]);
    }
  }

  private getLevelVibe(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG:
        return 'deep dive debug notes for the curious minds';
      case LogLevel.INFO:
        return 'all green—smooth sailing ✨';
      case LogLevel.WARN:
        return 'heads up: consider a quick check';
      case LogLevel.ERROR:
        return 'action recommended—let’s untangle this';
      case LogLevel.FATAL:
        return 'critical stop—grab a teammate pronto';
      default:
        return '';
    }
  }

  private formatDataForConsole(data: unknown): string {
    if (data === null || typeof data !== 'object') {
      return chalk.yellow(this.stringifyPrimitive(data));
    }

    if (Array.isArray(data)) {
      if (!data.length) {
        return chalk.gray('data: []');
      }
      const preview = data.slice(0, 5).map((item, index) => `${chalk.gray(`#${index}`)}=${this.stringifyPrimitive(item)}`).join(chalk.gray(', '));
      const suffix = data.length > 5 ? chalk.gray(` … +${data.length - 5} more`) : '';
      return `data: ${chalk.yellow('[')}${preview}${suffix}${chalk.yellow(']')}`;
    }

    const entries = Object.entries(data as Record<string, unknown>);
    if (!entries.length) {
      return chalk.gray('data: {}');
    }

    const preview = entries.slice(0, 6).map(([key, value]) => `${chalk.green(key)}=${chalk.yellow(this.stringifyPrimitive(value))}`).join(chalk.gray(', '));
    const suffix = entries.length > 6 ? chalk.gray(` … +${entries.length - 6} more keys`) : '';
    return `data: ${preview}${suffix}`;
  }

  private stringifyPrimitive(value: unknown): string {
    if (value === null) return 'null';
    switch (typeof value) {
      case 'undefined':
        return 'undefined';
      case 'string':
        return value.length > 40 ? `${value.slice(0, 37)}…` : value;
      case 'number':
      case 'boolean':
        return String(value);
      case 'object':
        return JSON.stringify(value);
      default:
        return String(value);
    }
  }

  private outputToConsole(entry: LogEntry, message: string): void {
    if (entry.level < this.consoleLevel) {
      return;
    }

    switch (entry.level) {
      case LogLevel.DEBUG:
        console.debug(message);
        break;
      case LogLevel.INFO:
        console.info(message);
        break;
      case LogLevel.WARN:
        console.warn(message);
        break;
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        console.error(message);
        break;
    }
  }

  debug(component: string, message: string, data?: any): void {
    this.log(LogLevel.DEBUG, component, message, data);
  }

  info(component: string, message: string, data?: any): void {
    this.log(LogLevel.INFO, component, message, data);
  }

  warn(component: string, message: string, data?: any, error?: Error): void {
    this.log(LogLevel.WARN, component, message, data, error);
  }

  error(component: string, message: string, data?: any, error?: Error): void {
    this.log(LogLevel.ERROR, component, message, data, error);
  }

  fatal(component: string, message: string, data?: any, error?: Error): void {
    this.log(LogLevel.FATAL, component, message, data, error);
  }

  async close(): Promise<void> {
    const promises: Promise<void>[] = [];
    
    for (const writer of this.writers.values()) {
      promises.push(new Promise((resolve) => {
        writer.end(resolve);
      }));
    }
    
    await Promise.all(promises);
    this.writers.clear();
  }
}
