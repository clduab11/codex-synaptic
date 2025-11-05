import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { dump as dumpYaml } from 'js-yaml';
import type {
  CodexContext,
  CodexContextAggregationMetadata
} from '../types/codex-context.js';

const WORKSPACE_DIR = '.codex-synaptic';

async function ensureWorkspacePath(projectRoot: string): Promise<string> {
  const dir = path.join(projectRoot, WORKSPACE_DIR);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function safeWrite(filePath: string, contents: string): Promise<void> {
  await fs.writeFile(filePath, contents, 'utf8');
}

export async function persistCodexContextBlock(projectRoot: string, block: string): Promise<string | null> {
  try {
    const dir = await ensureWorkspacePath(projectRoot);
    const target = path.join(dir, 'codex-context-latest.md');
    await safeWrite(target, block);
    return target;
  } catch (error) {
    console.warn('[codex-guidance] Failed to persist context block', error);
    return null;
  }
}

export async function persistCodexToolkit(
  projectRoot: string,
  context: CodexContext,
  metadata: CodexContextAggregationMetadata
): Promise<string | null> {
  try {
    const dir = await ensureWorkspacePath(projectRoot);
    const toolkitPath = path.join(dir, 'codex-toolkit.yaml');
    const payload = {
      generated_at: new Date().toISOString(),
      metadata,
      context_overview: {
        agent_directives: context.agentDirectives.length,
        readme_excerpts: context.readmeExcerpts.length,
        directories_indexed: metadata.codexDirectoryCount,
        databases_indexed: metadata.databaseCount
      }
    };
    await safeWrite(toolkitPath, dumpYaml(payload));
    return toolkitPath;
  } catch (error) {
    console.warn('[codex-guidance] Failed to persist toolkit manifest', error);
    return null;
  }
}

export async function writeCodexHandbook(
  projectRoot: string,
  context: CodexContext,
  metadata: CodexContextAggregationMetadata
): Promise<string | null> {
  try {
    const dir = await ensureWorkspacePath(projectRoot);
    const handbookPath = path.join(dir, 'codex-handbook.md');
    const lines: string[] = [];
    lines.push('# Codex-Synaptic Operator Handbook');
    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');
    lines.push('## Snapshot Summary');
    lines.push(`- Agent directives: ${context.agentDirectives.length}`);
    lines.push(`- README excerpts: ${context.readmeExcerpts.length}`);
    lines.push(`- Indexed directories: ${metadata.codexDirectoryCount}`);
    lines.push(`- Indexed databases: ${metadata.databaseCount}`);
    lines.push('');
    lines.push('## Quick Start');
    lines.push('- Launch swarm orchestrations with `codex-synaptic hive-mind spawn` commands.');
    lines.push('- Inspect system health via `codex-synaptic system status`.');
    lines.push('- Explore generated toolkit artifacts inside `.codex-synaptic/`.');
    await safeWrite(handbookPath, lines.join('\n'));
    return handbookPath;
  } catch (error) {
    console.warn('[codex-guidance] Failed to write handbook', error);
    return null;
  }
}

export async function persistCodexReplArtifacts(
  projectRoot: string,
  _context: CodexContext,
  _metadata: CodexContextAggregationMetadata,
  artifacts: {
    prompt?: string;
    enrichedPrompt?: string | null;
  }
): Promise<{ promptPath?: string; handbookPath?: string }> {
  try {
    const dir = await ensureWorkspacePath(projectRoot);
    const promptPath = artifacts.prompt
      ? path.join(dir, 'codex-repl-prompt.txt')
      : undefined;
    const handbookPath = artifacts.enrichedPrompt
      ? path.join(dir, 'codex-repl-enriched-prompt.txt')
      : undefined;

    if (promptPath) {
      await safeWrite(promptPath, artifacts.prompt!);
    }
    if (handbookPath && artifacts.enrichedPrompt) {
      await safeWrite(handbookPath, artifacts.enrichedPrompt);
    }

    return {
      promptPath,
      handbookPath
    };
  } catch (error) {
    console.warn('[codex-guidance] Failed to persist REPL artifacts', error);
    return {
      promptPath: undefined,
      handbookPath: undefined
    };
  }
}
