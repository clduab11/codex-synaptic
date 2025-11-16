
import { AgentType } from './types.js';
import { CodexSynapticSystem } from './system.js';
import * as fs from 'fs';
import * as path from 'path';
import { scanRepository, type ScanReport } from './scanner.js';
import chalk from 'chalk';
import { analyzePromptForAgents, type AgentComposition } from './agent-composition-strategy.js';

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

/**
 * Analyze prompt and determine agent composition
 * Refactored to use strategy pattern (RF-1.3)
 * Re-exported for backward compatibility
 */
export { analyzePromptForAgents, type AgentComposition };

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
