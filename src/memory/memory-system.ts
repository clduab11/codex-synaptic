import sqlite3 from 'sqlite3';
import { join, dirname } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { Logger } from '../core/logger.js';
import { AgentType } from '../core/types.js';

export interface MemorySystemOptions {
  enableTenancy?: boolean;
}

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
  tenantId?: string;
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
  tenantId?: string;
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
  private tenancyEnabled: boolean;
  private logger = Logger.getInstance('memory');

  constructor(basePath: string = process.cwd(), options: MemorySystemOptions = {}) {
    this.basePath = basePath;
    this.dbPath = join(this.basePath, '.codex-synaptic', 'memory.db');
    const dbDir = dirname(this.dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }
    this.db = new sqlite3.Database(this.dbPath);
    this.tenancyEnabled = Boolean(options.enableTenancy);
    this.initializeTables();
    if (this.tenancyEnabled) {
      this.ensureTenancySchema();
    }
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

  async store(namespace: string, key: string, data: any, options?: { tenantId?: string }): Promise<number> {
    if (data === null || typeof data === 'undefined') {
      await this.delete(namespace, key, options);
      return 0;
    }
    const tenantId = options?.tenantId;
    return await new Promise<number>((resolve, reject) => {
      const query = this.tenancyEnabled
        ? 'INSERT INTO memory_entries (namespace, key, data, tenant_id) VALUES (?, ?, ?, ?)'
        : 'INSERT INTO memory_entries (namespace, key, data) VALUES (?, ?, ?)';
      const stmt = this.db.prepare(query);
      const params = this.tenancyEnabled
        ? [namespace, key, JSON.stringify(data), tenantId ?? null]
        : [namespace, key, JSON.stringify(data)];
      stmt.run(params, function(this: SqliteRunResult, err: Error | null) {
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

  async logToolUsage(record: ToolUsageRecord, options?: { tenantId?: string }): Promise<number> {
    const timestamp = record.timestamp ?? new Date().toISOString();
    const key = record.id ?? this.generateKey(record.toolId);
    const payload = {
      ...record,
      tenantId: record.tenantId ?? options?.tenantId,
      timestamp
    };
    return this.store('tool_usage', key, payload, options);
  }

  async listToolUsage(
    limit = 25,
    filter?: { toolId?: string; agentType?: AgentType; tenantId?: string }
  ): Promise<ToolUsageRecord[]> {
    const entries = await this.list('tool_usage', limit, { tenantId: filter?.tenantId });
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

  async logReasoningRun(record: ReasoningRunRecord, options?: { tenantId?: string }): Promise<number> {
    const timestamp = record.timestamp ?? new Date().toISOString();
    const key = record.id ?? this.generateKey(record.planId);
    if (record.id) {
      await this.delete('reasoning_runs', record.id, options).catch(() => {});
    }
    const payload = {
      ...record,
      timestamp
    };
    return this.store('reasoning_runs', key, payload, options);
  }

  async listReasoningRuns(
    limit = 25,
    filter?: { status?: ReasoningRunRecord['status']; planType?: ReasoningRunRecord['planType']; tenantId?: string }
  ): Promise<ReasoningRunRecord[]> {
    const entries = await this.list('reasoning_runs', limit, { tenantId: filter?.tenantId });
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

  async getLatestReasoningRun(planId: string, options?: { tenantId?: string }): Promise<ReasoningRunRecord | null> {
    const entries = await this.listReasoningRuns(100, { tenantId: options?.tenantId });
    for (const record of entries) {
      if (record.planId === planId) {
        return record;
      }
    }
    return null;
  }

  async list(
    namespace: string,
    limit = 10,
    options?: { tenantId?: string }
  ): Promise<Array<{ id: number; key: string; data: any; timestamp: string; tenantId?: string | null }>> {
    const tenantId = options?.tenantId;
    return await new Promise((resolve, reject) => {
      const conditions = ['namespace = ?'];
      const params: Array<string | number | null> = [namespace];
      if (this.tenancyEnabled && tenantId) {
        conditions.push('(tenant_id = ? OR tenant_id IS NULL)');
        params.push(tenantId);
      }
      params.push(limit);

      const selectFields = this.tenancyEnabled
        ? 'id, key, data, timestamp, tenant_id as tenantId'
        : 'id, key, data, timestamp';
      const query = `SELECT ${selectFields} FROM memory_entries WHERE ${conditions.join(
        ' AND '
      )} ORDER BY id DESC LIMIT ?`;
      this.db.all(
        query,
        params,
        (err: Error | null, rows: MemoryEntryRow[]) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(
            rows.map((row) => ({
              id: row.id,
              key: row.key,
              data: this.safeParse(row.data),
              timestamp: row.timestamp,
              tenantId: 'tenantId' in row ? row.tenantId ?? null : undefined
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

  async stats(options?: { tenantId?: string }): Promise<Record<string, number>> {
    return await new Promise((resolve, reject) => {
      const tenantId = options?.tenantId;
      const conditions: string[] = [];
      const params: Array<string | number> = [];
      if (this.tenancyEnabled && tenantId) {
        conditions.push('(tenant_id = ? OR tenant_id IS NULL)');
        params.push(tenantId);
      }
      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const query = `SELECT namespace, COUNT(*) as count FROM memory_entries ${whereClause} GROUP BY namespace`;
      this.db.all(
        query,
        params,
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

  async get(
    namespace: string,
    id: number,
    options?: { tenantId?: string }
  ): Promise<{ id: number; key: string; data: any; timestamp: string; tenantId?: string | null } | null> {
    return await new Promise((resolve, reject) => {
      const tenantId = options?.tenantId;
      const conditions = ['namespace = ?', 'id = ?'];
      const params: Array<string | number | null> = [namespace, id];
      if (this.tenancyEnabled && tenantId) {
        conditions.push('(tenant_id = ? OR tenant_id IS NULL)');
        params.push(tenantId);
      }
      const selectFields = this.tenancyEnabled
        ? 'id, key, data, timestamp, tenant_id as tenantId'
        : 'id, key, data, timestamp';
      const query = `SELECT ${selectFields} FROM memory_entries WHERE ${conditions.join(' AND ')}`;
      this.db.get(
        query,
        params,
        (err: Error | null, row: MemoryEntryRow | undefined) => {
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
            timestamp: row.timestamp,
            tenantId: 'tenantId' in row ? row.tenantId ?? null : undefined
          });
        }
      );
    });
  }

  async getByKey(
    namespace: string,
    key: string,
    options?: { tenantId?: string }
  ): Promise<{ id: number; key: string; data: any; timestamp: string; tenantId?: string | null } | null> {
    return await new Promise((resolve, reject) => {
      const tenantId = options?.tenantId;
      const conditions = ['namespace = ?', 'key = ?'];
      const params: Array<string | number | null> = [namespace, key];
      if (this.tenancyEnabled && tenantId) {
        conditions.push('(tenant_id = ? OR tenant_id IS NULL)');
        params.push(tenantId);
      }
      const selectFields = this.tenancyEnabled
        ? 'id, key, data, timestamp, tenant_id as tenantId'
        : 'id, key, data, timestamp';
      const query = `SELECT ${selectFields} FROM memory_entries WHERE ${conditions.join(' AND ')} ORDER BY id DESC LIMIT 1`;
      this.db.get(
        query,
        params,
        (err: Error | null, row: MemoryEntryRow | undefined) => {
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
            timestamp: row.timestamp,
            tenantId: 'tenantId' in row ? row.tenantId ?? null : undefined
          });
        }
      );
    });
  }

  async delete(namespace: string, key: string, options?: { tenantId?: string }): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const tenantId = options?.tenantId;
      const conditions = ['namespace = ?', 'key = ?'];
      const params: Array<string | null> = [namespace, key];
      if (this.tenancyEnabled && tenantId) {
        conditions.push('(tenant_id = ? OR tenant_id IS NULL)');
        params.push(tenantId);
      }
      const query = `DELETE FROM memory_entries WHERE ${conditions.join(' AND ')}`;
      const stmt = this.db.prepare(query);
      stmt.run(params, (err: Error | null) => {
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

  private ensureTenancySchema(): void {
    this.db.serialize(() => {
      this.db.run('ALTER TABLE memory_entries ADD COLUMN tenant_id TEXT', (err: Error | null) => {
        if (err && !/duplicate column/i.test(err.message)) {
          this.logger.warn('memory', 'Failed to extend memory_entries with tenant_id column', undefined, err);
        }
      });
      this.db.run(
        'CREATE INDEX IF NOT EXISTS idx_memory_entries_tenant ON memory_entries (tenant_id)',
        (err: Error | null) => {
          if (err) {
            this.logger.warn('memory', 'Failed to create tenant index on memory_entries', undefined, err);
          }
        }
      );
    });
  }
}
interface MemoryEntryRow {
  id: number;
  key: string;
  data: string;
  timestamp: string;
  tenantId?: string | null;
}
