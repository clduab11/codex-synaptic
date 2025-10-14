import * as fs from 'node:fs';
import * as path from 'node:path';
import sqlite3 from 'sqlite3';
import { createHash } from 'node:crypto';
import { scanRepository, type AgentsGuide } from '../core/scanner.js';
import { Logger } from '../core/logger.js';

/**
 * Instruction precedence levels from lowest to highest priority
 */
export enum InstructionPrecedence {
  GLOBAL = 1,
  PROJECT = 2,
  LOCAL = 3,
  OVERRIDE = 4
}

export interface InstructionMetadata {
  id: string;
  path: string;
  scope: string;
  precedence: InstructionPrecedence;
  contentHash: string;
  size: number;
  lastModified: Date;
  isValid: boolean;
  validationErrors?: string[];
}

export interface InstructionContext {
  agentDirectives: string;
  metadata: InstructionMetadata[];
  contextHash: string;
  aggregatedSize: number;
  precedenceChain: string[];
}

export interface InstructionCacheEntry {
  context: InstructionContext;
  timestamp: Date;
  ttl: number;
}

export interface InstructionCacheStatusEntry {
  id: string;
  rootPath: string;
  contextHash: string;
  createdAt: Date;
  expiresAt: Date;
  ttlSeconds: number;
  sizeBytes: number;
  isExpired: boolean;
}

export interface InstructionCacheStatus {
  entries: InstructionCacheStatusEntry[];
  totalEntries: number;
  totalSizeBytes: number;
  rootCount: number;
}

/**
 * Enhanced instruction parser with precedence handling and SQLite caching
 */
export class InstructionParser {
  private db: any;
  private logger = Logger.getInstance();
  private readonly cacheDir: string;
  private readonly dbPath: string;

  constructor(cacheDir?: string) {
    this.cacheDir = cacheDir || path.join(process.cwd(), '.codex-synaptic');
    this.dbPath = path.join(this.cacheDir, 'instructions.db');
    
    // Ensure cache directory exists
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }

    this.db = new sqlite3.Database(this.dbPath);
    this.initializeDatabase();
  }

  private initializeDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS instruction_cache (
        id TEXT PRIMARY KEY,
        root_path TEXT NOT NULL,
        context_data TEXT NOT NULL,
        context_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        ttl INTEGER DEFAULT 3600,
        UNIQUE(root_path, context_hash)
      );

      CREATE TABLE IF NOT EXISTS instruction_metadata (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        scope TEXT NOT NULL,
        precedence INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        size INTEGER NOT NULL,
        last_modified DATETIME NOT NULL,
        is_valid BOOLEAN DEFAULT 1,
        validation_errors TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_cache_root_path ON instruction_cache(root_path);
      CREATE INDEX IF NOT EXISTS idx_cache_hash ON instruction_cache(context_hash);
      CREATE INDEX IF NOT EXISTS idx_metadata_path ON instruction_metadata(file_path);
      CREATE INDEX IF NOT EXISTS idx_metadata_precedence ON instruction_metadata(precedence);
    `);
  }

  /**
   * Parse instructions from a repository with precedence handling and caching
   */
  async parseInstructions(rootPath: string, useCache: boolean = true): Promise<InstructionContext> {
    const absRoot = path.resolve(rootPath);
    
    // Check cache first if enabled
    if (useCache) {
      const cached = await this.getCachedInstructions(absRoot);
      if (cached) {
        this.logger.info('instructions', 'Instruction cache hit', { rootPath: absRoot, hash: cached.context.contextHash });
        return cached.context;
      }
    }

    // Scan repository for AGENTS.md files
    const scanReport = await scanRepository(absRoot);
    const agentsGuides = scanReport.agentsGuides;

    if (agentsGuides.length === 0) {
      this.logger.warn('instructions', 'No AGENTS.md files found', { rootPath: absRoot });
      return this.createEmptyContext(absRoot);
    }

    // Process guides with precedence
    const processedGuides = await this.processGuidesWithPrecedence(agentsGuides, absRoot);
    
    // Validate instruction files
    const validatedGuides = await this.validateInstructions(processedGuides, absRoot);

    // Build final context
    const context = await this.buildInstructionContext(validatedGuides, absRoot);

    // Cache the result
    if (useCache) {
      await this.cacheInstructions(absRoot, context);
    }

    this.logger.info('instructions', 'Instructions parsed successfully', {
      rootPath: absRoot,
      guidesCount: agentsGuides.length,
      contextHash: context.contextHash,
      totalSize: context.aggregatedSize
    });

    return context;
  }

  /**
   * Determine precedence based on file path relative to root
   */
  private determinePrecedence(guidePath: string, rootPath: string): InstructionPrecedence {
    const relativePath = path.relative(rootPath, guidePath);
    const depth = relativePath.split(path.sep).length - 1;

    // Global: In root directory
    if (depth === 0) {
      return InstructionPrecedence.GLOBAL;
    }

    // Project: In project directories (1-2 levels deep)
    if (depth <= 2) {
      return InstructionPrecedence.PROJECT;
    }

    // Local: Deeper nesting
    if (depth <= 4) {
      return InstructionPrecedence.LOCAL;
    }

    // Override: Very deep nesting or specific override patterns
    return InstructionPrecedence.OVERRIDE;
  }

  /**
   * Process guides with precedence ordering
   */
  private async processGuidesWithPrecedence(
    guides: AgentsGuide[], 
    rootPath: string
  ): Promise<InstructionMetadata[]> {
    const processed: InstructionMetadata[] = [];

    for (const guide of guides) {
      const fullPath = path.join(rootPath, guide.path);
      const precedence = this.determinePrecedence(fullPath, rootPath);
      const contentHash = createHash('sha256').update(guide.content).digest('hex');
      
      try {
        const stats = fs.statSync(fullPath);
        
        const metadata: InstructionMetadata = {
          id: createHash('md5').update(fullPath).digest('hex'),
          path: guide.path,
          scope: guide.scope,
          precedence,
          contentHash,
          size: guide.size,
          lastModified: stats.mtime,
          isValid: true,
          validationErrors: []
        };

        processed.push(metadata);
      } catch (error) {
        this.logger.error('instructions', 'Failed to process instruction file', { path: guide.path, error });
        continue;
      }
    }

    // Sort by precedence (ascending) then by path for deterministic ordering
    return processed.sort((a, b) => {
      if (a.precedence !== b.precedence) {
        return a.precedence - b.precedence;
      }
      return a.path.localeCompare(b.path);
    });
  }

  /**
   * Validate instruction files for syntax and content issues
   */
  private async validateInstructions(
    metadata: InstructionMetadata[],
    rootPath: string
  ): Promise<InstructionMetadata[]> {
    const validated: InstructionMetadata[] = [];

    for (const meta of metadata) {
      const fullPath = path.join(rootPath, meta.path);
      const validationErrors: string[] = [];

      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        
        // Basic markdown validation
        if (!content.trim()) {
          validationErrors.push('File is empty');
        }

        // Check for malformed sections
        const lines = content.split('\n');
        let inCodeBlock = false;
        let headerCount = 0;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          
          // Track code blocks
          if (line.trim().startsWith('```')) {
            inCodeBlock = !inCodeBlock;
          }

          // Check headers
          if (line.startsWith('#') && !inCodeBlock) {
            headerCount++;
            if (!/^#{1,6}\s+.+/.test(line)) {
              validationErrors.push(`Malformed header at line ${i + 1}: "${line}"`);
            }
          }
        }

        if (inCodeBlock) {
          validationErrors.push('Unclosed code block detected');
        }

        if (headerCount === 0) {
          validationErrors.push('No headers found - file may not be properly structured');
        }

        meta.isValid = validationErrors.length === 0;
        meta.validationErrors = validationErrors.length > 0 ? validationErrors : undefined;

        if (!meta.isValid) {
          this.logger.warn('instructions', 'Instruction file validation failed', {
            path: meta.path,
            errors: validationErrors
          });
        }

      } catch (error) {
        meta.isValid = false;
        meta.validationErrors = [`Failed to read file: ${error}`];
        this.logger.error('instructions', 'Instruction file validation error', { path: meta.path, error });
      }

      validated.push(meta);
    }

    return validated;
  }

  /**
   * Build final instruction context from validated metadata
   */
  private async buildInstructionContext(
    metadata: InstructionMetadata[],
    rootPath: string
  ): Promise<InstructionContext> {
    const validMetadata = metadata.filter(m => m.isValid);
    const segments: string[] = [];
    const precedenceChain: string[] = [];
    let aggregatedSize = 0;

    // Process in precedence order, with higher precedence overriding lower
    // Only use VALID files for content, but include ALL metadata
    for (const meta of validMetadata) {
      try {
        const fullPath = path.join(rootPath, meta.path);
        const content = fs.readFileSync(fullPath, 'utf8');
        
        segments.push(`\n## ${meta.scope} (${InstructionPrecedence[meta.precedence]})\n${content}`);
        precedenceChain.push(`${meta.scope}:${InstructionPrecedence[meta.precedence]}`);
        aggregatedSize += meta.size;
        
      } catch (error) {
        this.logger.error('instructions', 'Failed to read instruction file during context building', {
          path: meta.path,
          error
        });
      }
    }

    const agentDirectives = segments.length > 0 
      ? segments.join('\n\n---\n\n')
      : this.getDefaultDirectives();

    // Include ALL metadata (valid and invalid), not just valid ones
    const contextData = JSON.stringify({ agentDirectives, metadata, precedenceChain });
    const contextHash = createHash('sha256').update(contextData).digest('hex');

    return {
      agentDirectives,
      metadata, // Return ALL metadata, not just validMetadata
      contextHash,
      aggregatedSize,
      precedenceChain
    };
  }

  /**
   * Create empty context for repositories without AGENTS.md files
   */
  private createEmptyContext(_rootPath: string): InstructionContext {
    const agentDirectives = this.getDefaultDirectives();
    const contextData = JSON.stringify({ agentDirectives, metadata: [], precedenceChain: [] });
    const contextHash = createHash('sha256').update(contextData).digest('hex');

    return {
      agentDirectives,
      metadata: [],
      contextHash,
      aggregatedSize: agentDirectives.length,
      precedenceChain: ['default']
    };
  }

  /**
   * Get default agent directives when no AGENTS.md files are found
   */
  private getDefaultDirectives(): string {
    return `# Codex-Synaptic Default Directives

- Preserve sandbox integrity and follow security best practices
- Honor all AGENTS.md directives by scope precedence
- Maintain transparent logging for Codex orchestration
- Defer to Codex operator input on ambiguities
- Follow OpenAI usage policies and ethical guidelines
- Ensure deterministic and reproducible outputs where possible`;
  }

  /**
   * Get cached instructions if available and not expired
   */
  private async getCachedInstructions(rootPath: string): Promise<InstructionCacheEntry | null> {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM instruction_cache WHERE root_path = ? ORDER BY created_at DESC LIMIT 1',
        [rootPath],
        (err: Error | null, row: any) => {
          if (err) {
            reject(err);
            return;
          }

          if (!row) {
            resolve(null);
            return;
          }

          const created = new Date(row.created_at);
          const now = new Date();
          const ageSeconds = (now.getTime() - created.getTime()) / 1000;

          if (ageSeconds > row.ttl) {
            // Cache expired
            resolve(null);
            return;
          }

          try {
            const context: InstructionContext = JSON.parse(row.context_data);
            resolve({
              context,
              timestamp: created,
              ttl: row.ttl
            });
          } catch (parseError) {
            this.logger.error('instructions', 'Failed to parse cached instruction context', { error: parseError });
            resolve(null);
          }
        }
      );
    });
  }

  /**
   * Cache instruction context for future use
   */
  private async cacheInstructions(rootPath: string, context: InstructionContext): Promise<void> {
    return new Promise((resolve, reject) => {
      const contextData = JSON.stringify(context);
      const id = createHash('md5').update(`${rootPath}:${context.contextHash}`).digest('hex');

      this.db.run(
        `INSERT OR REPLACE INTO instruction_cache 
         (id, root_path, context_data, context_hash, ttl)
         VALUES (?, ?, ?, ?, ?)`,
        [id, rootPath, contextData, context.contextHash, 3600], // 1 hour TTL
        (err: Error | null) => {
          if (err) {
            this.logger.error('instructions', 'Failed to cache instruction context', { error: err });
            reject(err);
          } else {
            this.logger.debug('instructions', 'Instruction context cached', { rootPath, hash: context.contextHash });
            resolve();
          }
        }
      );
    });
  }

  /**
   * Retrieve cache summary for diagnostics and CLI display
   */
  async getCacheStatus(rootPath?: string): Promise<InstructionCacheStatus> {
    return new Promise((resolve, reject) => {
      const query = rootPath
        ? `SELECT id, root_path, context_hash, context_data, created_at, ttl
            FROM instruction_cache
            WHERE root_path = ?
            ORDER BY datetime(created_at) DESC`
        : `SELECT id, root_path, context_hash, context_data, created_at, ttl
            FROM instruction_cache
            ORDER BY datetime(created_at) DESC`;

      const params = rootPath ? [rootPath] : [];

      this.db.all(query, params, (err: Error | null, rows: Array<Record<string, any>>) => {
        if (err) {
          reject(err);
          return;
        }

        const entries: InstructionCacheStatusEntry[] = (rows || []).map((row) => {
          const createdAt = row.created_at ? new Date(row.created_at) : new Date();
          const ttlSeconds = typeof row.ttl === 'number' ? row.ttl : 0;
          const expiresAt = new Date(createdAt.getTime() + ttlSeconds * 1000);
          const contextData = typeof row.context_data === 'string' ? row.context_data : '';
          const sizeBytes = Buffer.byteLength(contextData, 'utf8');
          const isExpired = Date.now() > expiresAt.getTime();

          return {
            id: row.id,
            rootPath: row.root_path,
            contextHash: row.context_hash,
            createdAt,
            expiresAt,
            ttlSeconds,
            sizeBytes,
            isExpired
          };
        });

        const totalSizeBytes = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
        const rootCount = new Set(entries.map((entry) => entry.rootPath)).size;

        resolve({
          entries,
          totalEntries: entries.length,
          totalSizeBytes,
          rootCount
        });
      });
    });
  }

  /**
   * Clear instruction cache for a specific root path or all entries
   */
  async clearCache(rootPath?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const query = rootPath 
        ? 'DELETE FROM instruction_cache WHERE root_path = ?'
        : 'DELETE FROM instruction_cache';
      
      const params = rootPath ? [rootPath] : [];

      this.db.run(query, params, (err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          this.logger.info('instructions', 'Instruction cache cleared', { rootPath });
          resolve();
        }
      });
    });
  }

  /**
   * Validate instruction syntax without full parsing
   */
  async validateInstructionSyntax(filePath: string): Promise<{ isValid: boolean; errors: string[] }> {
    const errors: string[] = [];

    try {
      if (!fs.existsSync(filePath)) {
        errors.push('File does not exist');
        return { isValid: false, errors };
      }

      const content = fs.readFileSync(filePath, 'utf8');
      
      if (!content.trim()) {
        errors.push('File is empty');
      }

      // Basic markdown validation
      const lines = content.split('\n');
      let inCodeBlock = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (line.trim().startsWith('```')) {
          inCodeBlock = !inCodeBlock;
        }

        if (line.startsWith('#') && !inCodeBlock) {
          if (!/^#{1,6}\s+.+/.test(line)) {
            errors.push(`Malformed header at line ${i + 1}: "${line}"`);
          }
        }
      }

      if (inCodeBlock) {
        errors.push('Unclosed code block detected');
      }

    } catch (error) {
      errors.push(`Failed to read file: ${error}`);
    }

    return { isValid: errors.length === 0, errors };
  }

  /**
   * Close database connection
   */
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
