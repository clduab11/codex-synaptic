import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { collectPrometheusMetrics } from '../../src/observability/metric-exporter';
import { CodexMemorySystem } from '../../src/memory/memory-system';
import { AgentType } from '../../src/core/types';

describe('metric exporter', () => {
  let tempRoot: string;
  let memory: CodexMemorySystem;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'metric-exporter-'));
    memory = new CodexMemorySystem(tempRoot);
  });

  afterEach(async () => {
    await memory.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('emits tool and reasoning metrics with breakdowns', async () => {
    await memory.logToolUsage({
      toolId: 'code-generator',
      agentType: AgentType.CODE_WORKER,
      success: true,
      latencyMs: 180
    });

    await memory.logReasoningRun({
      id: 'plan-1',
      planId: 'plan-1',
      planType: 'tot',
      prompt: 'Evaluate repository health',
      status: 'completed',
      checkpoints: [],
      durationMs: 4200,
      timestamp: new Date().toISOString()
    });

    const lines = await collectPrometheusMetrics(memory);
    const toolRatioLine = lines.find((line) => line.includes('codex_synaptic_tool_usage_success_ratio{tool_id="code-generator"'));
    const reasoningLine = lines.find((line) => line.includes('codex_synaptic_reasoning_runs_status_total'));

    expect(toolRatioLine).toBeDefined();
    expect(reasoningLine).toBeDefined();
  });
});
