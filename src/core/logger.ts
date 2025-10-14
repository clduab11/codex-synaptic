/**
 * Centralized logging system for Codex-Synaptic
 */

import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

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

    const logLine = this.formatEntry(entry);
    
    // Console output
    this.outputToConsole(level, logLine);
    
    // File output
    const writer = this.getWriter(component);
    writer.write(logLine + '\n');

    // Also write to main log
    const mainWriter = this.getWriter('main');
    mainWriter.write(logLine + '\n');
  }

  private formatEntry(entry: LogEntry): string {
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

  private outputToConsole(level: LogLevel, message: string): void {
    if (level < this.consoleLevel) {
      return;
    }

    switch (level) {
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
