#!/usr/bin/env ts-node
import { Command } from 'commander';
import { writeFileSync } from 'fs';
import { CodexMemorySystem } from '../../src/memory/memory-system.js';
import { collectPrometheusMetrics } from '../../src/observability/metric-exporter.js';

const program = new Command();

program
  .description('Emit Codex-Synaptic telemetry as Prometheus metrics')
  .option('--output <file>', 'Path to Prometheus textfile output', '/tmp/codex-synaptic.prom')
  .option('--limit <count>', 'Number of recent entries per namespace to inspect', '100')
  .option('--tenant <tenantId>', 'Tenant scope for metrics ("all" for aggregate view)', 'all');

program.parse(process.argv);

const options = program.opts<{ output: string; limit: string; tenant?: string }>();

async function main(): Promise<void> {
  const limit = Number.parseInt(options.limit ?? '100', 10);
  if (Number.isNaN(limit) || limit <= 0) {
    throw new Error('--limit must be a positive integer');
  }

  const tenantOption = options.tenant ?? 'all';
  const tenantId = tenantOption.toLowerCase() === 'all' ? undefined : tenantOption;

  const memory = new CodexMemorySystem();
  const metrics = await collectPrometheusMetrics(memory, {
    limit,
    tenantId
  });
  writeFileSync(options.output, metrics.join('\n') + '\n', 'utf8');
  console.log(
    `Prometheus metrics written to ${options.output}${tenantId ? ` (tenant: ${tenantId})` : ''}`
  );
}

main().catch((error) => {
  console.error('Failed to export metrics:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
