/**
 * Rendering utilities for CLI output (tables, status displays, etc.)
 */

import chalk from "chalk";
import type { AgentMetadata } from "../../core/types.js";
import type { CodexSynapticSystem } from "../../core/system.js";
import type { ContextLogEntry } from "../../types/codex-context.js";
import { formatDetailEntry } from "./formatters.js";

/**
 * Renders a table of agents
 * @param agents - Array of agent metadata
 */
export function renderAgentTable(agents: AgentMetadata[]): void {
  if (!agents.length) {
    console.log(chalk.gray("No agents registered."));
    return;
  }

  const rows = agents.map((agent) => ({
    id: agent.id.id,
    type: agent.id.type,
    status: agent.status,
    capabilities: agent.capabilities.map((cap) => cap.name).join(", "),
    lastUpdated: agent.lastUpdated.toISOString(),
  }));

  console.table(rows);
}

/**
 * Renders neural mesh status
 * @param status - Mesh status object
 */
export function renderMeshStatus(status: any): void {
  console.log(chalk.blue("🕸️  Neural Mesh"));
  console.log(
    `  Running: ${status.isRunning ? chalk.green("yes") : chalk.red("no")}`,
  );
  console.log(`  Nodes: ${status.nodeCount}`);
  console.log(`  Connections: ${status.connectionCount}`);
  console.log(`  Avg connections: ${status.averageConnections.toFixed(2)}`);
  console.log(`  Topology: ${status.topology}`);
  if (typeof status.maxRunDurationMs !== "undefined") {
    const limitLabel =
      status.maxRunDurationMs > 0
        ? `${Math.round(status.maxRunDurationMs / 60000)}m`
        : "disabled";
    const remainingMinutes =
      status.runActive && typeof status.remainingTimeMs === "number"
        ? Math.max(0, Math.ceil(status.remainingTimeMs / 60000))
        : null;
    const activityLabel = status.runActive
      ? chalk.green("active")
      : chalk.gray("inactive");
    const remainingLabel =
      remainingMinutes !== null ? `, ${remainingMinutes}m remaining` : "";
    console.log(
      `  Orchestration: ${activityLabel} (limit ${limitLabel}${remainingLabel})`,
    );
  }
}

/**
 * Renders swarm coordination status
 * @param status - Swarm status object
 */
export function renderSwarmStatus(status: any): void {
  console.log(chalk.blue("🐝 Swarm Coordination"));
  console.log(
    `  Running: ${status.isRunning ? chalk.green("yes") : chalk.red("no")}`,
  );
  console.log(`  Algorithm: ${status.algorithm}`);
  console.log(`  Particle count: ${status.particleCount}`);
  console.log(`  Optimizing: ${status.isOptimizing ? "yes" : "no"}`);
  if (typeof status.maxRunDurationMs !== "undefined") {
    const limitLabel =
      status.maxRunDurationMs > 0
        ? `${Math.round(status.maxRunDurationMs / 60000)}m`
        : "disabled";
    const remainingMinutes =
      status.isOptimizing && typeof status.remainingTimeMs === "number"
        ? Math.max(0, Math.ceil(status.remainingTimeMs / 60000))
        : null;
    const activityLabel = status.isOptimizing
      ? chalk.green("active")
      : chalk.gray("idle");
    const remainingLabel =
      remainingMinutes !== null ? `, ${remainingMinutes}m remaining` : "";
    console.log(
      `  Orchestration: ${activityLabel} (limit ${limitLabel}${remainingLabel})`,
    );
  }
}

/**
 * Renders consensus manager status
 * @param system - Codex-Synaptic system instance
 */
export function renderConsensusStatus(system: CodexSynapticSystem): void {
  const manager = system.getConsensusManager();
  const status = manager.getStatus();
  console.log(chalk.blue("🗳️  Consensus Manager"));
  console.log(
    `  Running: ${status.isRunning ? chalk.green("yes") : chalk.red("no")}`,
  );
  console.log(`  Active proposals: ${status.activeProposals}`);
  console.log(`  Votes tracked: ${status.totalVotes}`);

  const proposals = manager.getActiveProposals();
  if (proposals.length) {
    console.log(chalk.cyan("  Proposals:"));
    for (const proposal of proposals) {
      const votes = manager.getVotes(proposal.id);
      const yesVotes = votes.filter((vote) => vote.vote).length;
      const noVotes = votes.length - yesVotes;
      console.log(
        `    • ${proposal.id} [${proposal.type}] — ${yesVotes} yes / ${noVotes} no / ${proposal.requiredVotes} required`,
      );
    }
  }
}

/**
 * Renders interactive command hints
 */
export function renderInteractiveHints(): void {
  console.log(chalk.blueBright("💡 Interactive Command Hub"));
  console.log(
    "  • Navigate through guided menus for system, agents, mesh, swarm, hive-mind, consensus, and tasks.",
  );
  console.log(
    "  • Each submenu provides context-aware operations tailored to that subsystem.",
  );
  console.log(
    '  • The "Run CLI command" option lets you execute any codex-synaptic subcommand without leaving this shell.',
  );
  console.log(
    "  • Dashboard view provides real-time snapshot of mesh, swarm, consensus, and resource metrics.",
  );
  console.log(
    "  • The system stays running when you exit interactive mode—choose explicit shutdown when needed.",
  );
  console.log(
    "  • Hive-mind quick spawn wizard auto-attaches Codex context (AGENTS.md, README, docs/) for repository-aware workflows.",
  );
  console.log("");
}

/**
 * Emits context aggregation logs
 * @param logs - Array of context log entries
 */
export function emitContextLogs(logs: ContextLogEntry[]): void {
  if (!logs.length) {
    return;
  }
  console.log(chalk.blue("🧾 Codex context aggregation log"));
  for (const entry of logs) {
    const detailText = entry.details ? formatDetailEntry(entry.details) : "";
    const suffix = detailText ? chalk.gray(` (${detailText})`) : "";
    if (entry.level === "info") {
      console.log(chalk.gray(`  • ${entry.message}`) + suffix);
    } else if (entry.level === "warn") {
      console.log(chalk.yellow(`  ⚠️ ${entry.message}`) + suffix);
    } else if (entry.level === "error") {
      console.log(chalk.red(`  ❌ ${entry.message}`) + suffix);
    }
  }
}

/**
 * Emits context summary
 * @param context - Codex context object
 * @param metadata - Context aggregation metadata
 */
export function emitContextSummary(context: any, metadata: any): void {
  console.log(chalk.cyan("📦 Codex Context Summary"));
  console.log(`  Directives: ${context.agentDirectives.length} entries`);
  console.log(`  README excerpts: ${context.readmeExcerpts.length} entries`);
  console.log(
    `  Directory inventory: ${context.directoryInventory.totalEntries} entries`,
  );
  console.log(
    `  Database metadata: ${context.databaseMetadata.length} databases`,
  );
  console.log(`  Context hash: ${context.contextHash}`);
  console.log(chalk.gray(`  Built at: ${context.timestamp.toISOString()}`));

  if (metadata.totalFiles > 0) {
    console.log(chalk.gray(`  Total files scanned: ${metadata.totalFiles}`));
  }
  if (metadata.totalSizeBytes > 0) {
    const sizeMB = (metadata.totalSizeBytes / 1024 / 1024).toFixed(2);
    console.log(chalk.gray(`  Total size: ${sizeMB} MB`));
  }
}

/**
 * Renders background job list
 * @param jobs - Array of background jobs
 */
export function renderBackgroundJobs(jobs: any[]): void {
  if (!jobs || !jobs.length) {
    console.log(chalk.gray("No background jobs running."));
    return;
  }

  console.log(chalk.cyan("🔄 Background Jobs"));
  for (const job of jobs) {
    const statusIcon =
      job.status === "running" ? chalk.green("●") : chalk.gray("○");
    console.log(
      `  ${statusIcon} ${job.id} - ${job.description} (started: ${new Date(job.startedAt).toLocaleString()})`,
    );
  }
}
