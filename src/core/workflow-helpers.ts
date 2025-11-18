/**
 * Helper functions for workflow building and outcome generation
 * Extracted to reduce complexity in CodexSynapticSystem
 */

export interface WorkflowRequirements {
  mentionsRepository: boolean;
  mentionsDocs: boolean;
  wantsReAct: boolean;
  requiresResearch: boolean;
  requiresArchitecture: boolean;
  requiresKnowledge: boolean;
  requiresDataAnalysis: boolean;
  requiresCode: boolean;
  requiresTesting: boolean;
}

export interface WorkflowArtifacts {
  research: any;
  reactPlan: any;
  architecture: any;
  code: any;
  lintIssues: any[];
  validation: any;
  insight: any;
  knowledge: any;
  openaiSynthesis: any;
}

/**
 * Analyze prompt to determine workflow requirements
 */
export function analyzePromptRequirements(prompt: string): WorkflowRequirements {
  const lower = prompt.toLowerCase();

  const mentionsRepository = /(repo|repository|codebase|pull request|self-improv|refactor|optim|bug|fix|issue|feature|patch)/.test(lower);
  const mentionsDocs = /(readme|agents\.md|documentation|docset|docs\/)/.test(lower);
  const wantsReAct = /(re-?act|plan\/apply\/test|reason\s*and\s*act|react methodology)/.test(lower);

  const requiresResearch =
    /(research|recon|discover|investig|intel|survey|learn|context)/.test(lower) ||
    wantsReAct ||
    mentionsDocs;

  const requiresArchitecture =
    /(architect|design|topology|mesh|blueprint|pipeline|infrastructure|consensus)/.test(lower) ||
    wantsReAct;

  const requiresKnowledge =
    mentionsDocs ||
    /(knowledge|documentation|brief|report|update|memory)/.test(lower) ||
    wantsReAct;

  const requiresDataAnalysis =
    /(analy|metric|data|stat|insight|learn|context|requirement|plan|evaluate)/.test(lower) ||
    mentionsRepository ||
    mentionsDocs ||
    wantsReAct;

  const requiresCode =
    /(code|build|implement|function|api|service|module|component|scaffold|engineer)/.test(lower) ||
    mentionsRepository ||
    wantsReAct;

  const requiresTesting =
    /(test|validate|verification|qa|quality|assurance|check|spec)/.test(lower) ||
    wantsReAct;

  return {
    mentionsRepository,
    mentionsDocs,
    wantsReAct,
    requiresResearch,
    requiresArchitecture,
    requiresKnowledge,
    requiresDataAnalysis,
    requiresCode,
    requiresTesting
  };
}

/**
 * Extract artifacts from workflow stage results
 */
export function extractWorkflowArtifacts(stageResults: Record<string, any>): WorkflowArtifacts {
  return {
    research: stageResults['research-scan']?.result ?? null,
    reactPlan: stageResults['react-plan']?.result ?? null,
    architecture: stageResults['architecture-blueprint']?.result ?? null,
    code: stageResults['code-generation']?.result?.generatedCode ?? null,
    lintIssues: stageResults['code-lint']?.result?.issues ?? [],
    validation: stageResults['validation']?.result ?? null,
    insight: stageResults['insight-summary']?.result ?? null,
    knowledge: stageResults['knowledge-distillation']?.result ?? null,
    openaiSynthesis: stageResults['openai-synthesis']?.result ?? null
  };
}

/**
 * Build summary from workflow artifacts
 */
export function buildWorkflowSummary(artifacts: WorkflowArtifacts): string {
  const summaryParts: string[] = [];

  if (artifacts.research?.summary) {
    summaryParts.push(artifacts.research.summary);
  }
  if (artifacts.reactPlan?.summary) {
    summaryParts.push(artifacts.reactPlan.summary);
  }
  if (artifacts.architecture?.summary) {
    summaryParts.push(artifacts.architecture.summary);
  }
  if (artifacts.code) {
    summaryParts.push('Generated implementation scaffold.');
  }
  if (artifacts.lintIssues.length === 0) {
    summaryParts.push('Code lint checks passed.');
  }
  if (artifacts.validation?.passed) {
    summaryParts.push('Validation gates satisfied.');
  }
  if (artifacts.knowledge?.summary) {
    summaryParts.push(artifacts.knowledge.summary);
  }
  if (artifacts.insight?.summary) {
    summaryParts.push(artifacts.insight.summary);
  }
  if (artifacts.openaiSynthesis?.summary) {
    summaryParts.push(artifacts.openaiSynthesis.summary);
  }

  if (summaryParts.length === 0) {
    return 'Workflow executed with available agents.';
  }

  return summaryParts.join(' ');
}

/**
 * Extract final answer from synthesis result
 */
export function extractFinalAnswer(openaiSynthesis: any): string | undefined {
  return typeof openaiSynthesis?.finalAnswer === 'string'
    ? openaiSynthesis.finalAnswer
    : undefined;
}
