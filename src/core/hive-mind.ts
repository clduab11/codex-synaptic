
import { AgentType } from './types.js';
import { CodexSynapticSystem } from './system.js';
import * as fs from 'fs';
import * as path from 'path';
import { scanRepository, type ScanReport } from './scanner.js';
import chalk from 'chalk';

export async function executeHiveMindSpawn(prompt: string, options: any): Promise<void> {
  const system = new CodexSynapticSystem();
  await system.initialize();

  const agentComposition = analyzePromptForAgents(prompt);

  // Deploy agents
  for (const agent of agentComposition) {
    await system.deployAgent(agent.type, agent.count);
  }

  // Create neural mesh
  await system.createNeuralMesh(options.meshTopology, options.agents);

  // Start swarm
  await system.startSwarm(options.algorithm);

  // Execute task
  const results = await system.executeTask(prompt);

  // Attempt to detect and scan a target repository from the prompt
  const targetPath = extractTargetPathFromPrompt(prompt);
  if (targetPath) {
    try {
      const report: ScanReport = await scanRepository(targetPath);
      (results as any).scan = {
        targetPath,
        summary: report.summary,
        stats: report.stats,
        suggestions: report.suggestions?.slice(0, 10) || []
      };
      if (report.agentsGuides?.length) {
        const topGuide = report.agentsGuides[0];
        const directives = (topGuide?.highlights || []).slice(0, 5);
        if (directives.length) {
          console.log(chalk.yellow('📜 AGENTS.md directives (top):'));
          for (const d of directives) {
            console.log('  • ' + d);
          }
        }
      }
      // Persist detailed artifacts under logs/hive-mind
      const outDir = path.resolve(process.cwd(), 'logs', 'hive-mind');
      fs.mkdirSync(outDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const scanJson = path.join(outDir, `scan-${ts}.json`);
      const scanMd = path.join(outDir, `scan-${ts}.md`);
      fs.writeFileSync(scanJson, JSON.stringify(report, null, 2));
      fs.writeFileSync(scanMd, renderScanMarkdown(report));

      // Persist AGENTS.md artifacts for reference
      for (const guide of report.agentsGuides) {
        const safeRel = guide.path.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = path.join(outDir, `AGENTS_${safeRel}`);
        fs.writeFileSync(filePath, guide.content);
      }
    } catch (err) {
      (results as any).scan = { error: `Scan failed: ${(err as Error).message}` };
    }
  }

  // Save results
  fs.writeFileSync('./hive-mind-results.json', JSON.stringify(results, null, 2));

  await system.shutdown();
}

export function analyzePromptForAgents(prompt: string): Array<{ type: AgentType, count: number }> {
  const promptLower = prompt.toLowerCase();
  const composition: Array<{ type: AgentType, count: number }> = [];

  if (promptLower.includes('code') || promptLower.includes('program') || promptLower.includes('develop')) {
    composition.push({ type: AgentType.CODE_WORKER, count: 3 });
  }

  if (promptLower.includes('data') || promptLower.includes('analyze') || promptLower.includes('process')) {
    composition.push({ type: AgentType.DATA_WORKER, count: 2 });
  }

  if (promptLower.includes('test') || promptLower.includes('validate') || promptLower.includes('check')) {
    composition.push({ type: AgentType.VALIDATION_WORKER, count: 1 });
  }

  // Always include coordinators for hive-mind
  composition.push({ type: AgentType.SWARM_COORDINATOR, count: 1 });
  composition.push({ type: AgentType.TOPOLOGY_COORDINATOR, count: 1 });

  // Always include voting agents for RAFT consensus quorum (requires minVotes=2, config default)
  // These three agent types participate in consensus voting to prevent timeout
  // Note: bootstrap deploys multiple voting agents (2 consensus, 1 review, 1 planning) for redundancy
  composition.push({ type: AgentType.CONSENSUS_COORDINATOR, count: 1 });
  composition.push({ type: AgentType.REVIEW_WORKER, count: 1 });
  composition.push({ type: AgentType.PLANNING_WORKER, count: 1 });

  return composition.length > 2 ? composition : [
    { type: AgentType.CODE_WORKER, count: 2 },
    { type: AgentType.DATA_WORKER, count: 1 },
    { type: AgentType.SWARM_COORDINATOR, count: 1 },
    { type: AgentType.CONSENSUS_COORDINATOR, count: 1 },
    { type: AgentType.REVIEW_WORKER, count: 1 },
    { type: AgentType.PLANNING_WORKER, count: 1 }
  ];
}

function extractTargetPathFromPrompt(prompt: string): string | null {
  // First, look for explicit mention of the-fantasizer-1 and resolve common locations
  const tokens = ['the-fantasizer-1'];
  const cwd = process.cwd();
  for (const token of tokens) {
    if (prompt.toLowerCase().includes(token)) {
      const candidates = [
        path.resolve(cwd, token),
        path.resolve(cwd, '..', token),
        path.resolve(cwd, '../..', token)
      ];
      for (const p of candidates) {
        try {
          const stat = fs.statSync(p);
          if (stat.isDirectory()) return p;
        } catch {}
      }
    }
  }
  // Fallback: extract simple path-like words and test them
  const m = prompt.match(/[\w./-]+/g) || [];
  for (const frag of m) {
    if (frag.length < 2) continue;
    const p = path.resolve(cwd, frag);
    try {
      const stat = fs.statSync(p);
      if (stat.isDirectory()) return p;
    } catch {}
  }
  return null;
}

function renderScanMarkdown(report: ScanReport): string {
  const lines: string[] = [];
  lines.push(`# Hive-Mind Repository Scan Report`);
  lines.push('');
  lines.push(`Target: ${report.target}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`## Summary`);
  lines.push(report.summary);
  lines.push('');
  lines.push(`## Stats`);
  lines.push(`- Files: ${report.stats.totalFiles}`);
  lines.push(`- Directories: ${report.stats.totalDirs}`);
  if (report.stats.languages && Object.keys(report.stats.languages).length) {
    lines.push(`- Languages:`);
    for (const [lang, count] of Object.entries(report.stats.languages)) {
      lines.push(`  - ${lang}: ${count}`);
    }
  }
  lines.push('');
  if (report.packages?.length) {
    lines.push('## Packages/Workspaces');
    for (const pkg of report.packages.slice(0, 50)) {
      lines.push(`- ${pkg.name} (${pkg.path})`);
    }
    if (report.packages.length > 50) {
      lines.push(`- ...and ${report.packages.length - 50} more`);
    }
    lines.push('');
  }
  if (report.findings?.length) {
    lines.push('## Findings');
    for (const f of report.findings) {
      lines.push(`- [${f.severity}] ${f.title} — ${f.detail}`);
    }
    lines.push('');
  }
  if (report.agentsGuides?.length) {
    lines.push('## AGENTS.md Guides');
    for (const g of report.agentsGuides.slice(0, 10)) {
      lines.push(`- ${g.path} (scope: ${g.scope}, size: ${g.size} bytes)`);
      if (g.highlights?.length) {
        for (const h of g.highlights.slice(0, 5)) {
          lines.push(`  - ${h}`);
        }
      }
    }
    if (report.agentsGuides.length > 10) {
      lines.push(`- ...and ${report.agentsGuides.length - 10} more`);
    }
    lines.push('');
  }
  if (report.suggestions?.length) {
    lines.push('## Suggestions (Top)');
    for (const s of report.suggestions.slice(0, 20)) {
      lines.push(`- ${s}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
