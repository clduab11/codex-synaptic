import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { 
  InstructionParser, 
  InstructionPrecedence
} from '../../src/instructions/index.js';

const writeFile = (filePath: string, content: string) => {
  fs.mkdirSync(dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
};

describe('InstructionParser', () => {
  let tempRoot: string;
  let parser: InstructionParser;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(join(tmpdir(), 'instruction-parser-'));
  });

  afterEach(async () => {
    if (parser) {
      await parser.close();
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('handles repositories with no AGENTS.md files', async () => {
    parser = new InstructionParser(join(tempRoot, '.cache'));
    
    const context = await parser.parseInstructions(tempRoot, false);
    
    expect(context.metadata).toHaveLength(0);
    expect(context.agentDirectives).toContain('Codex-Synaptic Default Directives');
    expect(context.precedenceChain).toEqual(['default']);
    expect(context.contextHash).toBeDefined();
  });

  it('processes single AGENTS.md file with global precedence', async () => {
    writeFile(join(tempRoot, 'AGENTS.md'), '# Test Instructions\n\n- Must follow test protocols\n- Should validate inputs');
    
    parser = new InstructionParser(join(tempRoot, '.cache'));
    const context = await parser.parseInstructions(tempRoot, false);
    
    expect(context.metadata).toHaveLength(1);
    expect(context.metadata[0].precedence).toBe(InstructionPrecedence.GLOBAL);
    expect(context.metadata[0].scope).toBe('.');
    expect(context.agentDirectives).toContain('Test Instructions');
    expect(context.agentDirectives).toContain('Must follow test protocols');
    expect(context.precedenceChain).toEqual(['.:GLOBAL']);
  });

  it('handles multiple AGENTS.md files with correct precedence ordering', async () => {
    // Global level
    writeFile(join(tempRoot, 'AGENTS.md'), '# Global Instructions\n\n- Global rule 1');
    
    // Project level
    writeFile(join(tempRoot, 'backend/AGENTS.md'), '# Backend Instructions\n\n- Backend rule 1');
    
    // Local level  
    writeFile(join(tempRoot, 'backend/auth/service/AGENTS.md'), '# Auth Service Instructions\n\n- Auth rule 1');
    
    parser = new InstructionParser(join(tempRoot, '.cache'));
    const context = await parser.parseInstructions(tempRoot, false);
    
    expect(context.metadata).toHaveLength(3);
    
    // Check precedence ordering (should be sorted by precedence)
    expect(context.metadata[0].precedence).toBe(InstructionPrecedence.GLOBAL);
    expect(context.metadata[1].precedence).toBe(InstructionPrecedence.PROJECT);
    expect(context.metadata[2].precedence).toBe(InstructionPrecedence.LOCAL);
    
    // Check scopes
    expect(context.metadata[0].scope).toBe('.');
    expect(context.metadata[1].scope).toBe('backend');
    expect(context.metadata[2].scope).toBe('backend/auth/service');
    
    // Check content includes all sections
    expect(context.agentDirectives).toContain('Global Instructions');
    expect(context.agentDirectives).toContain('Backend Instructions');
    expect(context.agentDirectives).toContain('Auth Service Instructions');
    
    // Check precedence chain
    expect(context.precedenceChain).toEqual(['.:GLOBAL', 'backend:PROJECT', 'backend/auth/service:LOCAL']);
  });

  it('validates instruction files and reports errors', async () => {
    // Valid file
    writeFile(join(tempRoot, 'AGENTS.md'), '# Valid Instructions\n\n- Rule 1\n- Rule 2');
    
    // Invalid file with malformed header
    writeFile(join(tempRoot, 'invalid/AGENTS.md'), '#Missing space\n\n- Rule 1\n\n```unclosed code block\ncode here');
    
    parser = new InstructionParser(join(tempRoot, '.cache'));
    const context = await parser.parseInstructions(tempRoot, false);
    
    expect(context.metadata).toHaveLength(2);
    
    const validFile = context.metadata.find(m => m.path === 'AGENTS.md');
    const invalidFile = context.metadata.find(m => m.path === 'invalid/AGENTS.md');
    
    expect(validFile?.isValid).toBe(true);
    expect(validFile?.validationErrors).toBeUndefined();
    
    expect(invalidFile?.isValid).toBe(false);
    expect(invalidFile?.validationErrors).toBeDefined();
    expect(invalidFile?.validationErrors).toContain('Malformed header at line 1: "#Missing space"');
    expect(invalidFile?.validationErrors).toContain('Unclosed code block detected');
  });

  it('uses cache when enabled and cache is valid', async () => {
    writeFile(join(tempRoot, 'AGENTS.md'), '# Cached Instructions\n\n- Cache test');
    
    parser = new InstructionParser(join(tempRoot, '.cache'));
    
    // First call should parse and cache
    const context1 = await parser.parseInstructions(tempRoot, true);
    expect(context1.metadata).toHaveLength(1);
    
    // Second call should use cache
    const context2 = await parser.parseInstructions(tempRoot, true);
    expect(context2.metadata).toHaveLength(1);
    expect(context2.contextHash).toBe(context1.contextHash);
  });

  it('invalidates cache when files are modified', async () => {
    const agentsPath = join(tempRoot, 'AGENTS.md');
    writeFile(agentsPath, '# Original Instructions\n\n- Original rule');
    
    parser = new InstructionParser(join(tempRoot, '.cache'));
    
    // First call
    const context1 = await parser.parseInstructions(tempRoot, true);
    const hash1 = context1.contextHash;
    
    // Clear cache to simulate file change invalidation
    await parser.clearCache(tempRoot);
    
    // Modify file
    writeFile(agentsPath, '# Modified Instructions\n\n- Modified rule');
    
    // Second call should reparse due to cache clearing
    const context2 = await parser.parseInstructions(tempRoot, true);
    expect(context2.contextHash).not.toBe(hash1);
    expect(context2.agentDirectives).toContain('Modified Instructions');
  });

  it('reports cache status with entry metadata', async () => {
    writeFile(join(tempRoot, 'AGENTS.md'), '# Status Instructions\n\n- Entry details');

    parser = new InstructionParser(join(tempRoot, '.cache'));
    await parser.parseInstructions(tempRoot, true);

    const status = await parser.getCacheStatus();
    expect(status.totalEntries).toBe(1);
    expect(status.totalSizeBytes).toBeGreaterThan(0);
    expect(status.rootCount).toBe(1);

    const entry = status.entries[0];
    expect(entry.rootPath).toContain(tempRoot);
    expect(entry.contextHash).toHaveLength(64);
    expect(entry.sizeBytes).toBeGreaterThan(0);
    expect(entry.isExpired).toBe(false);

    const scopedStatus = await parser.getCacheStatus(tempRoot);
    expect(scopedStatus.totalEntries).toBe(1);
  });

  it('validates individual file syntax correctly', async () => {
    const validFile = join(tempRoot, 'valid.md');
    const invalidFile = join(tempRoot, 'invalid.md');
    
    writeFile(validFile, '# Valid File\n\n## Section\n\n- Item 1\n- Item 2');
    writeFile(invalidFile, '# Valid Header\n\n```\nunclosed code block');
    
    parser = new InstructionParser(join(tempRoot, '.cache'));
    
    const validResult = await parser.validateInstructionSyntax(validFile);
    expect(validResult.isValid).toBe(true);
    expect(validResult.errors).toHaveLength(0);
    
    const invalidResult = await parser.validateInstructionSyntax(invalidFile);
    expect(invalidResult.isValid).toBe(false);
    expect(invalidResult.errors).toContain('Unclosed code block detected');
  });

  it('handles empty instruction files', async () => {
    writeFile(join(tempRoot, 'AGENTS.md'), '');
    
    parser = new InstructionParser(join(tempRoot, '.cache'));
    const context = await parser.parseInstructions(tempRoot, false);
    
    expect(context.metadata).toHaveLength(1);
    expect(context.metadata[0].isValid).toBe(false);
    expect(context.metadata[0].validationErrors).toContain('File is empty');
  });

  it('calculates correct precedence levels based on directory depth', async () => {
    // Root level (depth 0) = GLOBAL
    writeFile(join(tempRoot, 'AGENTS.md'), '# Global');
    
    // 1 level deep = PROJECT  
    writeFile(join(tempRoot, 'api/AGENTS.md'), '# API Project');
    
    // 2 levels deep = PROJECT
    writeFile(join(tempRoot, 'api/v1/AGENTS.md'), '# API V1 Project');
    
    // 3 levels deep = LOCAL
    writeFile(join(tempRoot, 'api/v1/auth/AGENTS.md'), '# Auth Local');
    
    // 5 levels deep = OVERRIDE
    writeFile(join(tempRoot, 'api/v1/auth/service/impl/AGENTS.md'), '# Override');
    
    parser = new InstructionParser(join(tempRoot, '.cache'));
    const context = await parser.parseInstructions(tempRoot, false);
    
    expect(context.metadata).toHaveLength(5);
    
    const global = context.metadata.find(m => m.scope === '.');
    const apiProject = context.metadata.find(m => m.scope === 'api');
    const v1Project = context.metadata.find(m => m.scope === 'api/v1');
    const authLocal = context.metadata.find(m => m.scope === 'api/v1/auth');
    const override = context.metadata.find(m => m.scope === 'api/v1/auth/service/impl');
    
    expect(global?.precedence).toBe(InstructionPrecedence.GLOBAL);
    expect(apiProject?.precedence).toBe(InstructionPrecedence.PROJECT);
    expect(v1Project?.precedence).toBe(InstructionPrecedence.PROJECT);
    expect(authLocal?.precedence).toBe(InstructionPrecedence.LOCAL);
    expect(override?.precedence).toBe(InstructionPrecedence.OVERRIDE);
  });

  it('handles nonexistent file validation gracefully', async () => {
    parser = new InstructionParser(join(tempRoot, '.cache'));
    
    const result = await parser.validateInstructionSyntax(join(tempRoot, 'nonexistent.md'));
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('File does not exist');
  });

  it('clears cache correctly', async () => {
    writeFile(join(tempRoot, 'AGENTS.md'), '# Cache Test');
    
    parser = new InstructionParser(join(tempRoot, '.cache'));
    
    // Parse and cache
    await parser.parseInstructions(tempRoot, true);
    
    // Clear cache
    await parser.clearCache(tempRoot);
    
    // Should work without errors (cache cleared)
    const context = await parser.parseInstructions(tempRoot, true);
    expect(context.metadata).toHaveLength(1);
  });

  it('generates deterministic context hashes', async () => {
    writeFile(join(tempRoot, 'AGENTS.md'), '# Deterministic Test\n\n- Rule 1\n- Rule 2');
    
    parser = new InstructionParser(join(tempRoot, '.cache'));
    
    const context1 = await parser.parseInstructions(tempRoot, false);
    const context2 = await parser.parseInstructions(tempRoot, false);
    
    expect(context1.contextHash).toBe(context2.contextHash);
  });
});
