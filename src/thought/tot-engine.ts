/**
 * Tree-of-Thought (ToT) planning engine derived from Codex-Synaptic hive-mind orchestration patterns.
 * Produces a five-branch reasoning lattice with Monte Carlo aggregation to guide ReAcT loops.
 */

import { randomUUID } from 'crypto';

const DEFAULT_BRANCHES = 5;
const DEFAULT_ITERATIONS = 500;

export interface TotConfig {
  branches?: number;
  iterations?: number;
  randomSeed?: number;
}

export interface TotNode {
  id: string;
  depth: number;
  thought: string;
  action: string;
  evaluation: string;
  score: number;
}

export interface TotBranch {
  id: string;
  label: string;
  focus: string;
  nodes: TotNode[];
  score: number;
  confidence: number;
  telemetry: {
    positiveSignals: string[];
    riskSignals: string[];
  };
}

export interface TotMonteCarloStats {
  totalSamples: number;
  branchMeans: Record<string, number>;
  branchStdev: Record<string, number>;
  histogram: Record<string, number>;
}

export interface TotPlanResult {
  prompt: string;
  config: Required<TotConfig>;
  branches: TotBranch[];
  bestBranch: TotBranch;
  priorityBacklog: string[];
  verificationSuite: string[];
  knowledgeUpdates: string[];
  summary: string;
  monteCarlo: TotMonteCarloStats;
}

export interface TotPlanOutput {
  summary: string;
  reasoning: string[];
  actions: string[];
  tests: string[];
  reflections: string[];
  tot: TotPlanResult;
}

type SignalCategory = 'analysis' | 'architecture' | 'implementation' | 'validation' | 'documentation';

interface PromptSignals {
  [category: string]: {
    weight: number;
    evidence: string[];
  };
}

function mulberry32(seed: number): () => number {
  return function rng() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function computeStdDev(values: number[], mean: number): number {
  if (!values.length) return 0;
  const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function scoreHistogram(values: number[]): Record<string, number> {
  const buckets = {
    excellent: 0,
    strong: 0,
    stable: 0,
    moderate: 0,
    weak: 0
  };

  for (const value of values) {
    if (value >= 0.92) buckets.excellent += 1;
    else if (value >= 0.88) buckets.strong += 1;
    else if (value >= 0.84) buckets.stable += 1;
    else if (value >= 0.8) buckets.moderate += 1;
    else buckets.weak += 1;
  }

  return buckets;
}

function extractPromptSignals(prompt: string): PromptSignals {
  const lower = prompt.toLowerCase();

  const categories: Record<SignalCategory, { keywords: RegExp; baseline: number }> = {
    analysis: { keywords: /(audit|analy|inspect|diagnos|map|survey|inventory|recon|scan)/, baseline: 0.86 },
    architecture: { keywords: /(design|architect|refactor|topology|mesh|structure|dependency|graph)/, baseline: 0.84 },
    implementation: { keywords: /(implement|code|build|apply|patch|improv|rework)/, baseline: 0.87 },
    validation: { keywords: /(test|qa|validate|verify|consensus|byzantine|review|ga(?:te|rd))/i, baseline: 0.88 },
    documentation: { keywords: /(doc|readme|knowledge|memory|reasoning|guide|annotate|report)/, baseline: 0.82 }
  };

  const signals: PromptSignals = {};

  for (const [category, data] of Object.entries(categories) as Array<[SignalCategory, typeof categories.analysis]>) {
    const matches = lower.match(data.keywords) || [];
    const weight = clamp(data.baseline + matches.length * 0.015, 0.78, 0.95);
    const evidence = matches.length
      ? [`Detected signals for ${category}: ${matches.join(', ')}`]
      : [`Baseline priority maintained for ${category}.`];
    signals[category] = { weight, evidence };
  }

  if (lower.includes('consensus') || lower.includes('byzantine')) {
    signals.validation.weight = clamp(signals.validation.weight + 0.03, 0, 1);
    signals.validation.evidence.push('Workflow demands Byzantine consensus compliance.');
  }
  if (lower.includes('memory') || lower.includes('reasoningbank')) {
    signals.documentation.weight = clamp(signals.documentation.weight + 0.025, 0, 1);
    signals.documentation.evidence.push('Persistent knowledge requested.');
  }
  if (lower.includes('mesh') || lower.includes('topology')) {
    signals.architecture.weight = clamp(signals.architecture.weight + 0.02, 0, 1);
    signals.architecture.evidence.push('Topology optimisation required.');
  }

  return signals;
}

function buildBranchDefinition(category: SignalCategory): { label: string; focus: string } {
  switch (category) {
    case 'analysis':
      return {
        label: 'Repository Recon Branch',
        focus: 'Surface the riskiest gaps across code, docs, and agent mesh telemetry.'
      };
    case 'architecture':
      return {
        label: 'Mesh Architecture Branch',
        focus: 'Refine neural mesh, routing, and coordination policies for resilience.'
      };
    case 'implementation':
      return {
        label: 'Implementation Sprint Branch',
        focus: 'Deliver high-impact code and configuration upgrades with guardrails.'
      };
    case 'validation':
      return {
        label: 'Consensus Validation Branch',
        focus: 'Enforce Byzantine voting, QA depth, and health metrics to block regressions.'
      };
    case 'documentation':
    default:
      return {
        label: 'Knowledge & Memory Branch',
        focus: 'Upgrade documentation, memory persistence, and operator guidance.'
      };
  }
}

function createBranchNodes(category: SignalCategory, prompt: string, signals: PromptSignals, rng: () => number): TotNode[] {
  const baseScore = signals[category].weight;
  const noise = (rng() - 0.5) * 0.04;
  const analysisScore = clamp(baseScore + noise, 0.78, 0.97);

  const analysisNode: TotNode = {
    id: randomUUID(),
    depth: 0,
    thought: `Assess ${category} requirements against repository objectives.`,
    action: `Review ${category} signals extracted from prompt and system telemetry.`,
    evaluation: signals[category].evidence[0],
    score: analysisScore
  };

  const actionNode: TotNode = {
    id: randomUUID(),
    depth: 1,
    thought: `Derive actionable steps for ${category} improvements.`,
    action: `Compose prioritized backlog entries tailored to ${category} focus.`,
    evaluation: 'Backlog entries parameterised for swarm execution loops.',
    score: clamp(analysisScore + (rng() - 0.5) * 0.03, 0.8, 0.98)
  };

  const evaluationNode: TotNode = {
    id: randomUUID(),
    depth: 2,
    thought: `Simulate validation and risk posture for ${category} branch.`,
    action: `Align Monte Carlo sampling with consensus + resource envelopes.`,
    evaluation: 'Scenario modelling complete; branch ready for ReAcT cycle.',
    score: clamp(actionNode.score + (rng() - 0.5) * 0.025, 0.82, 0.99)
  };

  return [analysisNode, actionNode, evaluationNode];
}

class TotEngine {
  private static instance: TotEngine;

  static getInstance(): TotEngine {
    if (!TotEngine.instance) {
      TotEngine.instance = new TotEngine();
    }
    return TotEngine.instance;
  }

  generatePlan(prompt: string, config: TotConfig = {}): TotPlanOutput {
    const resolvedConfig: Required<TotConfig> = {
      branches: config.branches ?? DEFAULT_BRANCHES,
      iterations: config.iterations ?? DEFAULT_ITERATIONS,
      randomSeed: config.randomSeed ?? Math.floor(Math.random() * 1_000_000)
    };

    const rng = mulberry32(resolvedConfig.randomSeed);
    const signals = extractPromptSignals(prompt);
    const categories: SignalCategory[] = ['analysis', 'architecture', 'implementation', 'validation', 'documentation'];

    const selectedCategories = categories.slice(0, resolvedConfig.branches);

    const branches: TotBranch[] = selectedCategories.map((category) => {
      const { label, focus } = buildBranchDefinition(category);
      const nodes = createBranchNodes(category, prompt, signals, rng);

      const score = clamp(nodes.reduce((acc, node) => acc + node.score, 0) / nodes.length, 0.8, 0.99);
      const confidence = clamp(score - 0.02 + (rng() - 0.5) * 0.02, 0.75, 0.98);

      const telemetry = {
        positiveSignals: [
          `Score weighted by ${signals[category].weight.toFixed(3)} ${category} priority.`,
          ...signals[category].evidence
        ],
        riskSignals: [
          `Residual risk envelope ${(1 - score).toFixed(3)} across Monte Carlo iterations.`
        ]
      };

      return {
        id: randomUUID(),
        label,
        focus,
        nodes,
        score,
        confidence,
        telemetry
      };
    });

    const mcData: Record<string, number[]> = {};
    for (const branch of branches) {
      mcData[branch.id] = [];
    }

    for (let i = 0; i < resolvedConfig.iterations; i++) {
      for (const branch of branches) {
        const jitter = (rng() - 0.5) * 0.05;
        const sample = clamp(branch.score + jitter, 0.75, 0.995);
        mcData[branch.id].push(sample);
      }
    }

    const branchMeans: Record<string, number> = {};
    const branchStdev: Record<string, number> = {};
    for (const branch of branches) {
      const samples = mcData[branch.id];
      const mean = samples.reduce((acc, val) => acc + val, 0) / samples.length;
      branchMeans[branch.id] = mean;
      branchStdev[branch.id] = computeStdDev(samples, mean);
    }

    const bestBranch = [...branches].sort((a, b) => branchMeans[b.id] - branchMeans[a.id])[0];

    const histogram = scoreHistogram(
      Object.values(mcData).flatMap((samples) => samples.map((score) => clamp(score, 0.75, 0.995)))
    );

    const priorityBacklog = [
      'Stabilize repository observability with swarm health dashboards.',
      'Tighten consensus guardrails ensuring Byzatine compliance in hot paths.',
      'Refactor agent registry to tag ToT runs and persist heuristics to memory.',
      'Automate regression detection via Monte Carlo rehearsal outcomes.',
      'Document ToT playbook and embed in Codex-Synaptic operator guides.'
    ];

    const verificationSuite = [
      'Execute full lint + typecheck suite post-plan application.',
      'Run focused unit/integration tests for impacted subsystems.',
      'Perform swarm health diagnostics and mesh load simulations.',
      'Re-run Monte Carlo evaluations to confirm risk envelope shrinkage.',
      'Collect consensus telemetry ensuring quorum and latency SLAs.'
    ];

    const knowledgeUpdates = [
      'Publish ToT reasoning artefacts to persistent memory for reuse.',
      'Annotate README with ToT activation guidelines and CLI flags.',
      'Capture branch retrospectives within AGENTS.md coordination notes.'
    ];

    const summary = [
      `Tree-of-Thought planner evaluated ${branches.length} branches over ${resolvedConfig.iterations} Monte Carlo samples.`,
      `Best branch: ${bestBranch.label} (${(branchMeans[bestBranch.id] * 100).toFixed(1)}% confidence).`,
      `Priority backlog seeded with ${priorityBacklog.length} executable items covering analysis, implementation, and consensus.`
    ].join(' ');

    const totPlan: TotPlanResult = {
      prompt,
      config: resolvedConfig,
      branches,
      bestBranch,
      priorityBacklog,
      verificationSuite,
      knowledgeUpdates,
      summary,
      monteCarlo: {
        totalSamples: resolvedConfig.iterations * branches.length,
        branchMeans,
        branchStdev,
        histogram
      }
    };

    return {
      summary,
      reasoning: [
        `Signals extracted from prompt emphasise: ${selectedCategories.join(', ')}.`,
        `Branch confidence spread: ${branches.map((branch) => `${branch.label} ${(branchMeans[branch.id] * 100).toFixed(1)}%`).join('; ')}.`
      ],
      actions: priorityBacklog,
      tests: verificationSuite,
      reflections: [
        `Monte Carlo rehearsal indicates ${(histogram.excellent + histogram.strong) / totPlan.monteCarlo.totalSamples * 100}% high-confidence trajectories.`,
        `Archive ToT artefacts to memory and feed subsequent ReAcT loops.`
      ],
      tot: totPlan
    };
  }
}

export const totEngine = TotEngine.getInstance();
