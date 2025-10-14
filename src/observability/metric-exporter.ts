import { CodexMemorySystem } from '../memory/memory-system.js';

export interface MetricSnapshot {
  autoscalerScaleUp: number;
  autoscalerScaleDown: number;
  meshSelfHealing: number;
  totRuns: number;
  totFollowups: number;
  totBranchCounts: Record<string, number>;
  consensusAccepted: number;
  consensusRejected: number;
  toolUsageTotal: number;
  toolUsageSuccess: number;
  toolUsageFailure: number;
  toolLatencyAvgMs: number;
  toolSuccessRatio: number;
  reasoningRuns: number;
  reasoningCompleted: number;
  reasoningFailed: number;
  reasoningCheckpoints: number;
  reasoningDurationAvgMs: number;
  toolBreakdown: Record<string, {
    total: number;
    success: number;
    failure: number;
    successRatio: number;
    averageLatencyMs: number;
    perAgent: Record<string, {
      total: number;
      success: number;
      failure: number;
      successRatio: number;
      averageLatencyMs: number;
    }>;
  }>;
  reasoningPlanStatus: Record<string, Record<string, number>>;
}

export interface MetricOptions {
  limit?: number;
}

export async function collectMetrics(
  memory: CodexMemorySystem,
  options: MetricOptions = {}
): Promise<MetricSnapshot> {
  const limit = options.limit ?? 100;

  const autoscalerEntries = await memory.list('autoscaler_events', limit);
  const meshEntries = await memory.list('mesh_events', limit);
  const totRunEntries = await memory.list('tot_runs', limit);
  const totFollowupEntries = await memory.list('tot_followups', limit);
  const consensusEntries = await memory.list('consensus_events', limit);
  const toolUsageEntries = await memory.list('tool_usage', limit);
  const reasoningEntries = await memory.list('reasoning_runs', limit);

  const autoscalerScaleUp = autoscalerEntries.filter((entry) =>
    typeof entry.data?.appliedIncrement === 'number' && entry.data.appliedIncrement > 0
  ).length;
  const autoscalerScaleDown = autoscalerEntries.filter((entry) =>
    typeof entry.data?.appliedReduction === 'number' && entry.data.appliedReduction > 0
  ).length;

  const totBranchCounts: Record<string, number> = {};
  for (const entry of totRunEntries) {
    const label = entry.data?.bestBranch?.label ?? 'unknown';
    totBranchCounts[label] = (totBranchCounts[label] ?? 0) + 1;
  }

  const consensusAccepted = consensusEntries.filter((entry) => entry.data?.accepted === true).length;
  const consensusRejected = consensusEntries.filter((entry) => entry.data?.accepted === false).length;

  const toolUsageTotal = toolUsageEntries.length;
  const toolUsageSuccess = toolUsageEntries.filter((entry) => entry.data?.success === true).length;
  const toolUsageFailure = toolUsageEntries.filter((entry) => entry.data?.success === false).length;
  const toolLatencySum = toolUsageEntries.reduce((acc, entry) => acc + (entry.data?.latencyMs ?? 0), 0);
  const toolLatencyAvgMs = toolUsageTotal > 0 ? toolLatencySum / toolUsageTotal : 0;
  const toolSuccessRatio = toolUsageTotal > 0 ? toolUsageSuccess / toolUsageTotal : 0;

  const toolBreakdownMap = new Map<string, {
    total: number;
    success: number;
    failure: number;
    latencySum: number;
    perAgent: Map<string, { total: number; success: number; failure: number; latencySum: number }>;
  }>();

  for (const entry of toolUsageEntries) {
    const record = entry.data ?? {};
    const toolId = record.toolId ?? 'unknown';
    const agentType = record.agentType ?? 'unknown';
    const success = record.success === true;
    const latency = typeof record.latencyMs === 'number' ? record.latencyMs : 0;

    const aggregate = toolBreakdownMap.get(toolId) ?? {
      total: 0,
      success: 0,
      failure: 0,
      latencySum: 0,
      perAgent: new Map()
    };
    aggregate.total += 1;
    aggregate.latencySum += latency;
    if (success) {
      aggregate.success += 1;
    } else {
      aggregate.failure += 1;
    }

    const agentAggregate = aggregate.perAgent.get(agentType) ?? { total: 0, success: 0, failure: 0, latencySum: 0 };
    agentAggregate.total += 1;
    agentAggregate.latencySum += latency;
    if (success) {
      agentAggregate.success += 1;
    } else {
      agentAggregate.failure += 1;
    }
    aggregate.perAgent.set(agentType, agentAggregate);
    toolBreakdownMap.set(toolId, aggregate);
  }

  const toolBreakdown: MetricSnapshot['toolBreakdown'] = {};
  toolBreakdownMap.forEach((value, toolId) => {
    const perAgent: Record<string, { total: number; success: number; failure: number; successRatio: number; averageLatencyMs: number }> = {};
    value.perAgent.forEach((agentStats, agentType) => {
      perAgent[agentType] = {
        total: agentStats.total,
        success: agentStats.success,
        failure: agentStats.failure,
        successRatio: agentStats.total > 0 ? agentStats.success / agentStats.total : 0,
        averageLatencyMs: agentStats.total > 0 ? agentStats.latencySum / agentStats.total : 0
      };
    });
    toolBreakdown[toolId] = {
      total: value.total,
      success: value.success,
      failure: value.failure,
      successRatio: value.total > 0 ? value.success / value.total : 0,
      averageLatencyMs: value.total > 0 ? value.latencySum / value.total : 0,
      perAgent
    };
  });

  const reasoningRuns = reasoningEntries.length;
  const reasoningCompleted = reasoningEntries.filter((entry) => entry.data?.status === 'completed').length;
  const reasoningFailed = reasoningEntries.filter((entry) => entry.data?.status === 'failed').length;
  const reasoningCheckpoints = reasoningEntries.reduce(
    (acc, entry) => acc + (Array.isArray(entry.data?.checkpoints) ? entry.data.checkpoints.length : 0),
    0
  );
  const reasoningDurationSum = reasoningEntries.reduce((acc, entry) => acc + (entry.data?.durationMs ?? 0), 0);
  const reasoningDurationAvgMs = reasoningRuns > 0 ? reasoningDurationSum / reasoningRuns : 0;

  const reasoningPlanStatus = new Map<string, Map<string, number>>();
  reasoningEntries.forEach((entry) => {
    const planType = entry.data?.planType ?? 'unknown';
    const status = entry.data?.status ?? 'unknown';
    const typeMap = reasoningPlanStatus.get(planType) ?? new Map<string, number>();
    typeMap.set(status, (typeMap.get(status) ?? 0) + 1);
    reasoningPlanStatus.set(planType, typeMap);
  });

  const reasoningPlanStatusObj: Record<string, Record<string, number>> = {};
  reasoningPlanStatus.forEach((statusMap, planType) => {
    const statusObj: Record<string, number> = {};
    statusMap.forEach((count, status) => {
      statusObj[status] = count;
    });
    reasoningPlanStatusObj[planType] = statusObj;
  });

  return {
    autoscalerScaleUp,
    autoscalerScaleDown,
    meshSelfHealing: meshEntries.length,
    totRuns: totRunEntries.length,
    totFollowups: totFollowupEntries.length,
    totBranchCounts,
    consensusAccepted,
    consensusRejected,
    toolUsageTotal,
    toolUsageSuccess,
    toolUsageFailure,
    toolLatencyAvgMs,
    toolSuccessRatio,
    reasoningRuns,
    reasoningCompleted,
    reasoningFailed,
    reasoningCheckpoints,
    reasoningDurationAvgMs,
    toolBreakdown,
    reasoningPlanStatus: reasoningPlanStatusObj
  };
}

export function formatPrometheusMetrics(snapshot: MetricSnapshot): string[] {
  const lines: string[] = [];
  lines.push(`# Codex-Synaptic metrics generated ${new Date().toISOString()}`);
  lines.push(`codex_synaptic_autoscaler_scale_events_total{direction="up"} ${snapshot.autoscalerScaleUp}`);
  lines.push(`codex_synaptic_autoscaler_scale_events_total{direction="down"} ${snapshot.autoscalerScaleDown}`);
  lines.push(`codex_synaptic_mesh_self_healing_total ${snapshot.meshSelfHealing}`);
  lines.push(`codex_synaptic_tot_runs_total ${snapshot.totRuns}`);
  lines.push(`codex_synaptic_tot_followups_total ${snapshot.totFollowups}`);
  Object.entries(snapshot.totBranchCounts).forEach(([label, count]) => {
    const safeLabel = label.replace(/"/g, '\\"');
    lines.push(`codex_synaptic_tot_branch_total{branch="${safeLabel}"} ${count}`);
  });
  lines.push(`codex_synaptic_consensus_events_total{result="accepted"} ${snapshot.consensusAccepted}`);
  lines.push(`codex_synaptic_consensus_events_total{result="rejected"} ${snapshot.consensusRejected}`);
  lines.push(`codex_synaptic_tool_usage_total ${snapshot.toolUsageTotal}`);
  lines.push(`codex_synaptic_tool_usage_success_total ${snapshot.toolUsageSuccess}`);
  lines.push(`codex_synaptic_tool_usage_failure_total ${snapshot.toolUsageFailure}`);
  lines.push(`codex_synaptic_tool_usage_latency_average_ms ${snapshot.toolLatencyAvgMs.toFixed(2)}`);
  lines.push(`codex_synaptic_tool_usage_success_ratio ${snapshot.toolSuccessRatio.toFixed(4)}`);
  lines.push(`codex_synaptic_reasoning_runs_total ${snapshot.reasoningRuns}`);
  lines.push(`codex_synaptic_reasoning_runs_completed_total ${snapshot.reasoningCompleted}`);
  lines.push(`codex_synaptic_reasoning_runs_failed_total ${snapshot.reasoningFailed}`);
  lines.push(`codex_synaptic_reasoning_checkpoints_total ${snapshot.reasoningCheckpoints}`);
  lines.push(`codex_synaptic_reasoning_duration_average_ms ${snapshot.reasoningDurationAvgMs.toFixed(2)}`);

  const escapeLabel = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  Object.entries(snapshot.toolBreakdown).forEach(([toolId, stats]) => {
    const escapedToolId = escapeLabel(toolId);
    lines.push(`codex_synaptic_tool_usage_total{tool_id="${escapedToolId}"} ${stats.total}`);
    lines.push(`codex_synaptic_tool_usage_success_total{tool_id="${escapedToolId}"} ${stats.success}`);
    lines.push(`codex_synaptic_tool_usage_failure_total{tool_id="${escapedToolId}"} ${stats.failure}`);
    lines.push(`codex_synaptic_tool_usage_success_ratio{tool_id="${escapedToolId}"} ${stats.successRatio.toFixed(4)}`);
    lines.push(`codex_synaptic_tool_usage_latency_average_ms{tool_id="${escapedToolId}"} ${stats.averageLatencyMs.toFixed(2)}`);
    Object.entries(stats.perAgent).forEach(([agentType, agentStats]) => {
      const escapedAgent = escapeLabel(agentType);
      lines.push(
        `codex_synaptic_tool_usage_success_ratio{tool_id="${escapedToolId}",agent_type="${escapedAgent}"} ${agentStats.successRatio.toFixed(4)}`
      );
    });
  });

  Object.entries(snapshot.reasoningPlanStatus).forEach(([planType, statusCounts]) => {
    const escapedPlanType = escapeLabel(planType);
    Object.entries(statusCounts).forEach(([status, count]) => {
      const escapedStatus = escapeLabel(status);
      lines.push(
        `codex_synaptic_reasoning_runs_status_total{plan_type="${escapedPlanType}",status="${escapedStatus}"} ${count}`
      );
    });
  });
  return lines;
}

export async function collectPrometheusMetrics(
  memory: CodexMemorySystem,
  options?: MetricOptions
): Promise<string[]> {
  const snapshot = await collectMetrics(memory, options);
  return formatPrometheusMetrics(snapshot);
}
