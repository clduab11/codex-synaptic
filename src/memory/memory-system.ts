import sqlite3 from 'sqlite3';
import { join, dirname } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { AgentType } from '../core/types.js';

interface SqliteRunResult {
  lastID?: number;
}

export interface ToolUsageRecord {
  id?: string;
  toolId: string;
  agentType?: AgentType;
  capability?: string;
  promptEmbedding?: string;
  promptHash?: string;
  success: boolean;
  latencyMs?: number;
  confidence?: number;
  contextTags?: string[];
  metadata?: Record<string, any>;
  timestamp?: string;
}

export interface ReasoningCheckpoint {
  id: string;
  label: string;
  status: 'pending' | 'complete' | 'failed';
  summary?: string;
  timestamp: string;
  metrics?: Record<string, number>;
}

export interface ReasoningRunRecord {
  id?: string;
  planId: string;
  planType: 'react' | 'tot' | 'custom';
  prompt: string;
  status: 'draft' | 'awaiting_approval' | 'running' | 'completed' | 'failed' | 'aborted';
  bestBranch?: string;
  confidence?: number;
  checkpoints?: ReasoningCheckpoint[];
  metadata?: Record<string, any>;
  durationMs?: number;
  validation?: {
    consensusProposalId?: string;
    consensusAccepted?: boolean;
    validationAgent?: AgentType;
    finalizedAt?: string;
  };
  timestamp?: string;
}

export class CodexMemorySystem {
  private db: any;
  private basePath: string;
  private dbPath: string;

  constructor(basePath: string = process.cwd()) {
    this.basePath = basePath;
    this.dbPath = join(this.basePath, '.codex-synaptic', 'memory.db');
    const dbDir = dirname(this.dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }
    this.db = new sqlite3.Database(this.dbPath);
    this.initializeTables();
  }

  private initializeTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_interactions (
        id INTEGER PRIMARY KEY,
        agent_id TEXT,
        interaction_type TEXT,
        data TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS training_data (
        id INTEGER PRIMARY KEY,
        pattern TEXT,
        data TEXT,
        performance_metrics TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS memory_entries (
        id INTEGER PRIMARY KEY,
        namespace TEXT,
        key TEXT,
        data TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  async store(namespace: string, key: string, data: any): Promise<number> {
    if (data === null || typeof data === 'undefined') {
      await this.delete(namespace, key);
      return 0;
    }
    return await new Promise<number>((resolve, reject) => {
      const stmt = this.db.prepare(
        'INSERT INTO memory_entries (namespace, key, data) VALUES (?, ?, ?)'
      );
      stmt.run(namespace, key, JSON.stringify(data), function(this: SqliteRunResult, err: Error | null) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID ?? 0);
        }
      });
      stmt.finalize();
    });
  }

  private generateKey(prefix: string): string {
    const random = Math.random().toString(36).slice(2, 8);
    return `${prefix}-${Date.now()}-${random}`;
  }

  async logToolUsage(record: ToolUsageRecord): Promise<number> {
    const timestamp = record.timestamp ?? new Date().toISOString();
    const key = record.id ?? this.generateKey(record.toolId);
    const payload = {
      ...record,
      timestamp
    };
    return this.store('tool_usage', key, payload);
  }

  async listToolUsage(limit = 25, filter?: { toolId?: string; agentType?: AgentType }): Promise<ToolUsageRecord[]> {
    const entries = await this.list('tool_usage', limit);
    return entries
      .map((entry) => entry.data as ToolUsageRecord)
      .filter((record) => {
        if (!record) return false;
        if (filter?.toolId && record.toolId !== filter.toolId) {
          return false;
        }
        if (filter?.agentType && record.agentType !== filter.agentType) {
          return false;
        }
        return true;
      });
  }

  async logReasoningRun(record: ReasoningRunRecord): Promise<number> {
    const timestamp = record.timestamp ?? new Date().toISOString();
    const key = record.id ?? this.generateKey(record.planId);
    if (record.id) {
      await this.delete('reasoning_runs', record.id).catch(() => {});
    }
    const payload = {
      ...record,
      timestamp
    };
    return this.store('reasoning_runs', key, payload);
  }

  async listReasoningRuns(limit = 25, filter?: { status?: ReasoningRunRecord['status']; planType?: ReasoningRunRecord['planType'] }): Promise<ReasoningRunRecord[]> {
    const entries = await this.list('reasoning_runs', limit);
    return entries
      .map((entry) => entry.data as ReasoningRunRecord)
      .filter((record) => {
        if (!record) return false;
        if (filter?.status && record.status !== filter.status) {
          return false;
        }
        if (filter?.planType && record.planType !== filter.planType) {
          return false;
        }
        return true;
      });
  }

  async getLatestReasoningRun(planId: string): Promise<ReasoningRunRecord | null> {
    const entries = await this.listReasoningRuns(100);
    for (const record of entries) {
      if (record.planId === planId) {
        return record;
      }
    }
    return null;
  }

  async list(namespace: string, limit = 10): Promise<Array<{ id: number; key: string; data: any; timestamp: string }>> {
    return await new Promise((resolve, reject) => {
      this.db.all(
        'SELECT id, key, data, timestamp FROM memory_entries WHERE namespace = ? ORDER BY id DESC LIMIT ?',
        [namespace, limit],
        (err: Error | null, rows: Array<{ id: number; key: string; data: string; timestamp: string }>) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(
            rows.map((row) => ({
              id: row.id,
              key: row.key,
              data: this.safeParse(row.data),
              timestamp: row.timestamp
            }))
          );
        }
      );
    });
  }

  private safeParse(payload: string | null): any {
    if (!payload) return null;
    try {
      return JSON.parse(payload);
    } catch {
      return payload;
    }
  }

  async stats(): Promise<Record<string, number>> {
    return await new Promise((resolve, reject) => {
      this.db.all(
        'SELECT namespace, COUNT(*) as count FROM memory_entries GROUP BY namespace',
        (err: Error | null, rows: Array<{ namespace: string; count: number }>) => {
          if (err) {
            reject(err);
            return;
          }
          const aggregates: Record<string, number> = {};
          rows.forEach((row) => {
            aggregates[row.namespace] = row.count;
          });
          resolve(aggregates);
        }
      );
    });
  }

  getDatabasePath(): string {
    return this.dbPath;
  }

  async get(namespace: string, id: number): Promise<{ id: number; key: string; data: any; timestamp: string } | null> {
    return await new Promise((resolve, reject) => {
      this.db.get(
        'SELECT id, key, data, timestamp FROM memory_entries WHERE namespace = ? AND id = ?',
        [namespace, id],
        (err: Error | null, row: { id: number; key: string; data: string; timestamp: string } | undefined) => {
          if (err) {
            reject(err);
            return;
          }
          if (!row) {
            resolve(null);
            return;
          }
          resolve({
            id: row.id,
            key: row.key,
            data: this.safeParse(row.data),
            timestamp: row.timestamp
          });
        }
      );
    });
  }

  async delete(namespace: string, key: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const stmt = this.db.prepare('DELETE FROM memory_entries WHERE namespace = ? AND key = ?');
      stmt.run(namespace, key, (err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
      stmt.finalize();
    });
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}
