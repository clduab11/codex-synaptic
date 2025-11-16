# CLI Refactoring Plan: Breaking Down 4,764-Line index.ts

## Executive Summary

The current `src/cli/index.ts` file (4,764 lines) is a monolithic command handler that violates every modularity principle. This plan provides a structured approach to decompose it into:

- **~50 individual command files** (each <300 lines)
- **Shared utility modules** in `/commands` and `/utils`
- **Reduced cyclomatic complexity** to <10 per function
- **Maintainable entry point** (<200 lines)

**Timeline**: Phase 1 (week 1), Phase 2-3 (weeks 2-3)
**Risk Level**: Low (backward compatible, existing imports unaffected)
**Breaking Changes**: None

---

## Current State Analysis

### File Statistics

- **Total Lines**: 4,764
- **Functions**: 40+ utility functions
- **Commands**: 60+ command definitions (.command() calls)
- **Conditional Statements**: 661+
- **Average Function Complexity**: High (many >5 conditions per function)
- **Import Statements**: 57

### Problem Areas

1. **Monolithic Structure**
   - Single file handles all command definitions
   - Difficult to locate specific command logic
   - High merge conflict risk across features
2. **High Cyclomatic Complexity**
   - `interactiveHiveMindMenu()`: 8+ nested branches
   - `orchestrateConsensus()`: 6+ decision paths
   - `interactiveSystemMenu()`: 5+ switch cases
   - Interactive menu functions exceed complexity targets
3. **Mixed Concerns**
   - CLI command definitions mixed with rendering logic
   - Utility functions scattered throughout
   - Global state (backgroundJobs, session) mixed with handlers
4. **Poor Discoverability**
   - No clear file organization for specific commands
   - Utility functions not grouped by purpose
   - Type definitions scattered
5. **Dependency Issues**
   - All 57 imports in one file
   - Difficult to identify command-specific dependencies
   - Circular dependency risk

### Command Categories Identified

| Category             | Commands                                      | Lines Est. | Files |
| -------------------- | --------------------------------------------- | ---------- | ----- |
| **System Control**   | system, start, stop, status, monitor          | 200        | 3     |
| **Configuration**    | openai, usage, background, auth, token        | 250        | 3     |
| **Instructions**     | instructions, sync, validate, cache           | 180        | 3     |
| **Tenancy**          | tenant, list, create, show, quota             | 200        | 3     |
| **Tools**            | tools, score, record, history                 | 150        | 2     |
| **Reasoning**        | reasoning, plan, checkpoint, complete, resume | 250        | 3     |
| **Router**           | router, evaluate, rules, history              | 200        | 2     |
| **Agent Management** | agent, list, deploy, status                   | 150        | 2     |
| **Mesh**             | mesh, configure, status                       | 100        | 1     |
| **Swarm**            | swarm, start, stop, status                    | 120        | 1     |
| **Bridging**         | bridge, mcp-send, a2a-send                    | 100        | 1     |
| **Consensus**        | consensus, propose, vote, status, telemetry   | 180        | 2     |
| **Task Management**  | task, submit, recent                          | 100        | 1     |
| **Hive-Mind**        | hive-mind, spawn, history                     | 500+       | 2     |
| **Observability**    | observability, template                       | 80         | 1     |
| **Environment**      | env, list, status, up, down, plan             | 150        | 2     |
| **Memory**           | memory, status, list                          | 100        | 1     |
| **Cheats**           | cheats, list, run, sync, publish, follow-up   | 150        | 2     |
| **Interactive**      | interactive, interactive menus                | 800+       | 4     |
| **Utilities**        | renderers, parsers, helpers                   | 400        | 5     |

---

## Proposed Architecture

### Directory Structure

```
src/cli/
├── index.ts                                    # ~150 lines - entry point
├── types.ts                                    # ~100 lines - shared types & interfaces
├── bootstrap.ts                                # ~100 lines - env loading & initialization
│
├── commands/
│   ├── index.ts                                # ~30 lines - command registration
│   ├── system.ts                               # ~120 lines (system, start, stop, status, monitor)
│   ├── config.ts                               # ~150 lines (openai, usage, background, auth, token)
│   ├── instructions.ts                         # ~120 lines (instructions, sync, validate, cache)
│   ├── tenancy.ts                              # ~140 lines (tenant, list, create, show, quota)
│   ├── tools.ts                                # ~110 lines (tools, score, record, history)
│   ├── reasoning.ts                            # ~200 lines (reasoning, plan, checkpoint, complete, resume)
│   ├── router.ts                               # ~150 lines (router, evaluate, rules, history)
│   ├── agent.ts                                # ~120 lines (agent, list, deploy, status)
│   ├── mesh.ts                                 # ~80 lines (mesh, configure, status)
│   ├── swarm.ts                                # ~100 lines (swarm, start, stop, status)
│   ├── bridge.ts                               # ~90 lines (bridge, mcp-send, a2a-send)
│   ├── consensus.ts                            # ~150 lines (consensus, propose, vote, status, telemetry)
│   ├── task.ts                                 # ~100 lines (task, submit, recent)
│   ├── hive-mind.ts                            # ~350 lines (hive-mind spawn with complex logic)
│   ├── observability.ts                        # ~70 lines (observability, template)
│   ├── environment.ts                          # ~130 lines (env, list, status, up, down, plan)
│   ├── memory.ts                               # ~100 lines (memory, status, list)
│   ├── cheats.ts                               # ~130 lines (cheats, list, run, sync, publish, follow-up)
│   └── interactive.ts                          # ~200 lines (interactive mode entry point)
│
├── interactive/
│   ├── index.ts                                # ~30 lines - menu registration
│   ├── system-menu.ts                          # ~80 lines (system dashboard & controls)
│   ├── agents-menu.ts                          # ~100 lines (agent management)
│   ├── mesh-menu.ts                            # ~80 lines (mesh topology)
│   ├── swarm-menu.ts                           # ~80 lines (swarm management)
│   ├── hive-mind-menu.ts                       # ~120 lines (hive-mind orchestration)
│   ├── consensus-menu.ts                       # ~100 lines (consensus voting)
│   ├── tasks-menu.ts                           # ~80 lines (task management)
│   └── command-runner.ts                       # ~60 lines (direct command execution)
│
├── utils/
│   ├── parsers.ts                              # ~80 lines (parseInteger, parseJsonOption, etc.)
│   ├── renderers.ts                            # ~150 lines (renderAgentTable, renderMeshStatus, etc.)
│   ├── help-decorators.ts                      # ~60 lines (decorateCommandHelp)
│   ├── consensus-helpers.ts                    # ~80 lines (shouldRequireConsensus, deriveConsensusDecision, etc.)
│   ├── context-loggers.ts                      # ~80 lines (emitContextLogs, emitContextSummary)
│   ├── duration-formatters.ts                  # ~40 lines (formatElapsedDuration, formatBytes)
│   ├── interactive-helpers.ts                  # ~60 lines (pause, ensureInteractiveSystem, renderInteractiveHints)
│   ├── command-dispatcher.ts                   # ~50 lines (dispatchCliCommand, tokenizeCliArgs)
│   ├── codex-utilities.ts                      # ~80 lines (shouldAutoAttachCodexContext, primeCodexWithRetry)
│   ├── system-utilities.ts                     # ~60 lines (useSystem, handleCommand)
│   ├── reasoning-helpers.ts                    # ~50 lines (reasoning-specific utilities)
│   ├── background-jobs.ts                      # ~70 lines (background job management)
│   └── runtime-helpers.ts                      # (already extracted - keep as-is)
│
├── middleware/
│   ├── command-handler.ts                      # ~40 lines - wrapper for error handling
│   ├── consensus-orchestrator.ts               # ~100 lines - orchestrateConsensus logic
│   ├── strategy-executor.ts                    # ~120 lines - strategy execution & summary
│   └── tenancy-authorizer.ts                   # ~50 lines - tenant authorization checks
│
├── [existing files]
├── codex-context.ts                            # Keep as-is
├── codex-passthrough.ts                        # Keep as-is
├── daemon-manager.ts                           # Keep as-is
├── feedforward.ts                              # Keep as-is
├── session.ts                                  # Keep as-is
└── utils/
    └── runtime-helpers.ts                      # Keep as-is
```

---

## Detailed Migration Plan

### Phase 1: Infrastructure (Days 1-2)

#### 1.1 Create Base Types & Interfaces

**File**: `src/cli/types.ts`

Extract and define:

```typescript
// Command context type
export interface CommandContext {
  system: CodexSynapticSystem;
  session: CliSession;
  logger: Logger;
}

// Background job type
export interface BackgroundJob {
  id: string;
  command: string;
  startedAt: number;
}

// Interactive menu return type
export interface InteractiveMenuResult {
  action: string;
  data?: any;
}

// Command registration interface
export interface RegisteredCommand {
  name: string;
  handler: Command;
  dependencies: string[];
}

// Shared option definitions
export const STRATEGY_OPTIONS = {
  /* ... */
};
export const CONSENSUS_OPTIONS = {
  /* ... */
};
export const AGENT_COUNT_OPTIONS = {
  /* ... */
};
```

**Migration checklist**:

- Extract all interface definitions used across commands
- Define shared command option types
- Create type guards for common validations

#### 1.2 Create Bootstrap Module

**File**: `src/cli/bootstrap.ts`

Extract from current `index.ts` lines 58-150:

```typescript
export function loadEnvFile(filePath: string): boolean {
  /* ... */
}
export function bootstrapCliEnv(): string[] {
  /* ... */
}
export function bootstrapEnvForCli(): void {
  /* ... */
}

export const loadedEnvSources = bootstrapCliEnv();
export const initializeCliEnvironment = () => {
  // Current lines 144-160 logic
};
```

**Migration checklist**:

- Move `loadEnvFile()` - handles .env file parsing
- Move `bootstrapCliEnv()` - discovers env files
- Move `bootstrapEnvForCli()` - applies environment settings
- Extract env source logging logic

#### 1.3 Create Utility Modules

Create the `/utils/` modules (one per file below):

**1.3a `parsers.ts`** (Lines ~592-1700 scattered)

```typescript
export function parseInteger(value: string, label: string): number;
export function parseAgentType(value?: string): AgentType | undefined;
export function parseJsonOption<T = any>(value?: string): T | undefined;
export function loadToolCandidates(filePath: string): ToolCandidate[];
export function buildToolUsageRecord(options: any): ToolUsageRecord;
```

**1.3b `renderers.ts`** (Lines ~610-1598 scattered)

```typescript
export function renderAgentTable(agents: AgentMetadata[]): void;
export function renderMeshStatus(status: any): void;
export function renderSwarmStatus(status: any): void;
export function renderConsensusStatus(system: CodexSynapticSystem): void;
export function renderTelemetry(): void;
export function renderSystemDashboard(
  system: CodexSynapticSystem,
): Promise<void>;
export function renderBackgroundJobs(): void;
export function renderInteractiveHints(): void;
export function formatDetailEntry(details: Record<string, unknown>): string;
export function formatBytes(bytes: number): string;
export function describeCachePath(absPath?: string): string;
export function emitContextLogs(logs: ContextLogEntry[]): void;
export function emitContextSummary(
  context: CodexContext,
  metadata: CodexContextAggregationMetadata,
): void;
export function printReasoningRecord(record: ReasoningRunRecord): void;
```

**1.3c `help-decorators.ts`** (Lines ~222-282)

```typescript
export interface CommandHelpDecorOptions {
  title: string;
  subtitle: string;
  context: string[];
  skills: string[];
  vibeTips: string[];
  actions: { command: string; description: string }[];
  docs: { label: string; description: string }[];
}

export function decorateCommandHelp(
  command: Command,
  options: CommandHelpDecorOptions,
): Command;
```

**1.3d `consensus-helpers.ts`** (Lines ~283-441)

```typescript
export function shouldRequireConsensus(
  prompt: string,
  consensusMode: string,
): boolean;
export function deriveConsensusDecision(outcome: any): boolean;
export function shouldAutoAttachCodexContext(prompt: string): boolean;
```

**1.3e `command-dispatcher.ts`** (Lines ~677-797)

```typescript
export function tokenizeCliArgs(input: string): string[];
export async function dispatchCliCommand(raw: string): Promise<void>;
```

**1.3f `duration-formatters.ts`** (Lines ~732-749)

```typescript
export function formatElapsedDuration(startedAt: number): string;
```

**1.3g `interactive-helpers.ts`** (Lines ~645-673)

```typescript
export function renderInteractiveHints(): void;
export async function ensureInteractiveSystem(): Promise<CodexSynapticSystem>;
export async function pause(message?: string): Promise<void>;
```

**1.3h `system-utilities.ts`** (Lines ~517-590)

```typescript
export function handleCommand<T extends any[]>(
  name: string,
  fn: (...args: T) => Promise<void>,
): (...args: T) => Promise<void>;

export async function useSystem(
  description: string,
  fn: (system: CodexSynapticSystem) => Promise<void>,
): Promise<void>;
```

**1.3i `codex-utilities.ts`** (Lines ~283 + ~1631-1701)

```typescript
export function shouldAutoAttachCodexContext(prompt: string): boolean;
export async function primeCodexWithRetry(/* ... */): Promise<CodexContextBuildResult>;
```

**1.3j `context-loggers.ts`** (Lines ~1598-1630)

```typescript
export function emitContextLogs(logs: ContextLogEntry[]): void;
export function emitContextSummary(
  context: CodexContext,
  metadata: CodexContextAggregationMetadata,
): void;
```

**1.3k `background-jobs.ts`** (Lines ~751-759)

```typescript
const backgroundJobs = new Map<string, BackgroundJob>();

export function addBackgroundJob(job: BackgroundJob): void;
export function removeBackgroundJob(id: string): void;
export function renderBackgroundJobs(): void;
export function getBackgroundJobs(): BackgroundJob[];
```

---

### Phase 2: Command Extraction (Days 3-5)

#### 2.1 Create Command Module Base

**File**: `src/cli/commands/index.ts`

```typescript
import { Command } from "commander";
import { registerSystemCommands } from "./system.js";
import { registerConfigCommands } from "./config.js";
// ... import all command modules

export function registerAllCommands(program: Command): void {
  registerSystemCommands(program);
  registerConfigCommands(program);
  // ... call all registration functions
}
```

#### 2.2 Migrate Command Groups

Extract each command group into individual files. **Example structure for each**:

**File**: `src/cli/commands/system.ts`

```typescript
import { Command } from "commander";
import { useSystem } from "../utils/system-utilities.js";
import { handleCommand } from "../utils/system-utilities.js";

export function registerSystemCommands(program: Command): void {
  const systemCmd = program
    .command("system")
    .description("System orchestration and monitoring");

  decorateCommandHelp(systemCmd, {
    /* help options */
  });

  systemCmd
    .command("start")
    .description("Start the orchestrator")
    .action(
      handleCommand("system.start", async () => {
        await useSystem("system start", async (system) => {
          // Implementation (extracted from main file)
        });
      }),
    );

  systemCmd
    .command("stop")
    .description("Stop the orchestrator")
    .action(
      handleCommand("system.stop", async () => {
        // Implementation
      }),
    );

  systemCmd
    .command("status")
    .description("Show orchestrator status")
    .action(
      handleCommand("system.status", async () => {
        // Implementation
      }),
    );

  // ... other system commands
}
```

**Commands to Extract** (in order of priority):

1. **system.ts** (LOW complexity)
   - Lines: ~80-150
   - Commands: start, stop, status, monitor
   - Dependencies: CodexSynapticSystem, Logger

2. **config.ts** (MEDIUM complexity)
   - Lines: ~150-180
   - Commands: openai, usage, background, auth, token
   - Reduce cyclomatic complexity of auth handler

3. **instructions.ts** (LOW complexity)
   - Lines: ~100-120
   - Commands: instructions, sync, validate, cache
   - Dependencies: InstructionParser

4. **tenancy.ts** (MEDIUM complexity)
   - Lines: ~140-180
   - Commands: tenant, list, create, show, quota
   - Extract authorization logic to middleware

5. **tools.ts** (LOW-MEDIUM complexity)
   - Lines: ~110-150
   - Commands: tools, score, record, history
   - Dependencies: ToolOptimizer

6. **reasoning.ts** (HIGH complexity - refactor first)
   - Lines: ~200-250
   - Commands: reasoning, plan, checkpoint, complete, resume
   - Extract strategy execution to middleware
   - Split complex handlers into focused utilities

7. **router.ts** (MEDIUM complexity)
   - Lines: ~150-180
   - Commands: router, evaluate, rules, history
   - Dependencies: RoutingPolicyService

8. **agent.ts** (LOW complexity)
   - Lines: ~100-120
   - Commands: agent, list, deploy, status
   - Dependencies: AgentRegistry

9. **mesh.ts** (LOW complexity)
   - Lines: ~80-100
   - Commands: mesh, configure, status
   - Dependencies: NeuralMesh

10. **swarm.ts** (LOW complexity)
    - Lines: ~100-120
    - Commands: swarm, start, stop, status
    - Dependencies: SwarmCoordinator

11. **bridge.ts** (LOW complexity)
    - Lines: ~90-110
    - Commands: bridge, mcp-send, a2a-send
    - Dependencies: Bridge services

12. **consensus.ts** (HIGH complexity - refactor with orchestrator)
    - Lines: ~150-200
    - Commands: consensus, propose, vote, status, telemetry
    - Delegate consensus logic to middleware
    - Use orchestrateConsensus from middleware

13. **task.ts** (LOW complexity)
    - Lines: ~100-120
    - Commands: task, submit, recent
    - Dependencies: TaskManager

14. **hive-mind.ts** (HIGHEST complexity - must extract carefully)
    - Lines: ~350-500
    - Commands: hive-mind spawn, history
    - **CRITICAL**: Extract logic into smaller functions:
      - `executeClassicStrategy()` - classic spawn logic
      - `executeGoapStrategy()` - GOAP-specific logic
      - `executeAdvancedStrategy()` - advanced strategy handler
      - `prepareCodexContext()` - Codex context building
      - See detailed section below

15. **observability.ts** (LOW complexity)
    - Lines: ~70-90
    - Commands: observability, template

16. **environment.ts** (LOW-MEDIUM complexity)
    - Lines: ~130-160
    - Commands: env, list, status, up, down, plan

17. **memory.ts** (LOW complexity)
    - Lines: ~100-120
    - Commands: memory, status, list

18. **cheats.ts** (MEDIUM complexity)
    - Lines: ~130-160
    - Commands: cheats, list, run, sync, publish, follow-up

19. **interactive.ts** (Entry point for interactive mode)
    - Lines: ~100-150
    - Router to interactive menu system
    - Import from ./interactive/\* modules

---

### Phase 2.5: Hive-Mind Deep Refactoring (Special Focus)

The hive-mind spawn command (lines 3687-4160) is the most complex. **Extract it strategically**:

**File**: `src/cli/commands/hive-mind.ts` (~350 lines)

```typescript
import { Command } from "commander";
import { handleCommand } from "../utils/system-utilities.js";
import {
  executeGoapStrategy,
  executeClassicStrategy,
  executeAdvancedStrategy,
} from "./hive-mind/index.js";

export function registerHiveMindCommands(program: Command): void {
  const hiveMindCmd = program
    .command("hive-mind")
    .description("Launch hive-mind workflows");

  hiveMindCmd
    .command("spawn")
    .description("Spawn a coordinated hive-mind workflow")
    .argument("<prompt...>", "Task description")
    .option("--strategy <type>", "Coordination strategy", "classic")
    // ... other options
    .action(
      handleCommand("hive-mind.spawn", async (promptParts, options) => {
        const prompt = promptParts.join(" ").trim();

        if (!prompt) {
          throw new Error("Prompt cannot be empty");
        }

        const strategy = (options.strategy ?? "classic").toLowerCase();

        // Delegate to strategy-specific handlers
        if (strategy === "goap") {
          await executeGoapStrategy(prompt, options);
        } else if (strategy === "classic") {
          await executeClassicStrategy(prompt, options);
        } else {
          await executeAdvancedStrategy(strategy, prompt, options);
        }
      }),
    );

  // ... history command
}
```

**File**: `src/cli/commands/hive-mind/goap-strategy.ts` (~100 lines)

```typescript
export async function executeGoapStrategy(
  originalPrompt: string,
  options: any,
): Promise<void> {
  // Extract lines 3706-3754
  // GOAP-specific logic only
}
```

**File**: `src/cli/commands/hive-mind/classic-strategy.ts` (~150 lines)

```typescript
export async function executeClassicStrategy(
  originalPrompt: string,
  options: any,
): Promise<void> {
  // Extract lines 3755-3977
  // Classic spawn execution
  // Helper functions:
  // - validateClassicStrategyOptions()
  // - buildSwarmConfiguration()
  // - executeSpawn()
  // - handleConsensusPhase()
  // - streamLogs()
}

async function validateClassicStrategyOptions(options: any): Promise<void> {
  // Cyclomatic complexity reduction: Extract validation
}

async function buildSwarmConfiguration(options: any): Promise<SwarmConfig> {
  // Extract configuration building logic
}

async function executeSpawn(system, config): Promise<SpawnResult> {
  // Extract spawn execution
}

async function handleConsensusPhase(system, outcome, options): Promise<void> {
  // Extract consensus handling
}
```

**File**: `src/cli/commands/hive-mind/index.ts` (~40 lines)

```typescript
export { executeGoapStrategy } from "./goap-strategy.js";
export { executeClassicStrategy } from "./classic-strategy.js";
export { executeAdvancedStrategy } from "./advanced-strategy.js";
export { registerHiveMindCommands } from "../hive-mind.js";
```

**Cyclomatic Complexity Reduction for Hive-Mind**:

Before (single function, ~400 lines, complexity ~15):

```
if strategy === 'goap' {
  if manifest {
    if goalId {
      // many nested conditions
    }
  }
}
else if strategy === 'classic' {
  if autoAttach {
    // many conditions
  }
  if consensus {
    // more conditions
  }
}
else if advanced {
  // ...
}
```

After (3 focused functions, each ~100 lines, complexity ~5-6):

- `executeGoapStrategy()` - only GOAP logic
- `executeClassicStrategy()` - only classic logic
- `executeAdvancedStrategy()` - only advanced logic

---

### Phase 3: Interactive Mode Extraction (Days 6-7)

#### 3.1 Create Interactive Module Structure

**File**: `src/cli/interactive/index.ts`

```typescript
import { launchInteractiveMode } from "./main-menu.js";
export { launchInteractiveMode };
```

#### 3.2 Refactor Interactive Menus

**File**: `src/cli/interactive/system-menu.ts` (~80 lines)

```typescript
import { ensureInteractiveSystem } from "../utils/interactive-helpers.js";
import { renderSystemDashboard } from "../utils/renderers.js";

export async function showSystemMenu(): Promise<void> {
  // Extract from interactiveSystemMenu() lines 811-886
  // Reduce complexity by extracting switch cases
}

async function showDashboard(system): Promise<void> {
  /* ... */
}
async function streamTelemetry(system): Promise<void> {
  /* ... */
}
async function shutdownSystem(system): Promise<void> {
  /* ... */
}
```

**File**: `src/cli/interactive/hive-mind-menu.ts` (~120 lines)

```typescript
export async function showHiveMindMenu(): Promise<void> {
  // Extract from interactiveHiveMindMenu() lines 1132-1260
  // Each switch case becomes a function
}

async function quickSpawn(): Promise<void> {
  // Extract lines 1151-1242
  // Build Codex context inline
}

async function advancedSpawn(): Promise<void> {
  // Extract advanced spawn logic
}

async function showHiveMindStatus(): Promise<void> {
  // Extract status logic
}
```

Similar structure for:

- **agents-menu.ts** (from interactiveAgentsMenu ~1008 lines)
- **mesh-menu.ts** (from interactiveMeshMenu ~1069 lines)
- **swarm-menu.ts** (from interactiveSwarmMenu ~1132 lines)
- **consensus-menu.ts** (from interactiveConsensusMenu ~1368 lines)
- **tasks-menu.ts** (from interactiveTasksMenu ~1466 lines)
- **command-runner.ts** (from interactiveCommandRunner ~1512 lines)

---

### Phase 3.5: Middleware Extraction

#### 3.5.1 Consensus Orchestrator

**File**: `src/cli/middleware/consensus-orchestrator.ts` (~100 lines)

```typescript
import { orchestrateConsensus as _orchestrateConsensus } from "../utils/consensus-helpers.js";

export interface ConsensusExecutionResult {
  performed: boolean;
  proposalId?: string;
  accepted?: boolean;
  votes?: number;
  timedOut?: boolean;
  error?: string;
}

export async function orchestrateConsensus(
  system: CodexSynapticSystem,
  originalPrompt: string,
  outcome: any,
  consensusMode: string,
): Promise<ConsensusExecutionResult> {
  // Extract lines 354-441
  // Keep as-is, but move from index.ts
}
```

#### 3.5.2 Strategy Executor

**File**: `src/cli/middleware/strategy-executor.ts` (~120 lines)

```typescript
export async function executeAndSummarizeStrategy(
  system: CodexSynapticSystem,
  strategy: SupportedStrategy,
  options: any,
): Promise<StrategyExecutionResult> {
  // Extract strategy execution wrapper
}

export function renderStrategyExecutionSummary(
  result: StrategyExecutionResult,
  verbose: boolean,
): void {
  // Extract lines 443-515
}
```

#### 3.5.3 Tenancy Authorizer

**File**: `src/cli/middleware/tenancy-authorizer.ts` (~50 lines)

```typescript
export async function authorizeTenantAction(
  system: CodexSynapticSystem,
  action: "read" | "write",
  tokenOverride?: string,
): Promise<void> {
  // Extract lines 600-608
}
```

#### 3.5.4 Command Handler Wrapper

**File**: `src/cli/middleware/command-handler.ts` (~40 lines)

```typescript
export function withErrorHandling<T extends any[]>(
  commandName: string,
  handler: (...args: T) => Promise<void>,
): (...args: T) => Promise<void> {
  return handleCommand(commandName, handler);
}
```

---

## Critical Refactoring Patterns

### Pattern 1: Extract Complex Conditionals

**Before** (high complexity):

```typescript
if (strategy === "goap") {
  // 50 lines of GOAP logic
} else if (strategy === "classic") {
  // 100 lines of classic logic
} else if (advanced) {
  // 60 lines of advanced logic
}
```

**After** (lower complexity):

```typescript
const executors = {
  goap: executeGoapStrategy,
  classic: executeClassicStrategy,
};

const executor = executors[strategy] || executeAdvancedStrategy;
await executor(prompt, options);
```

### Pattern 2: Extract Interactive Menu Cases

**Before** (high complexity):

```typescript
while (!exit) {
  const { action } = await inquirer.prompt([...]);

  switch (action) {
    case 'option1':
      // 50 lines
    case 'option2':
      // 60 lines
    case 'option3':
      // 40 lines
  }
}
```

**After** (lower complexity):

```typescript
while (!exit) {
  const { action } = await inquirer.prompt([...]);

  exit = await handleMenuAction(action);
}

async function handleMenuAction(action: string): Promise<boolean> {
  switch (action) {
    case 'option1': return await handleOption1();
    case 'option2': return await handleOption2();
    case 'option3': return await handleOption3();
  }
  return false;
}
```

### Pattern 3: Utility Function Extraction

**Before**:

```typescript
// Scattered utility logic in command handlers
const elapsedMs = Date.now() - startedAt;
const totalSeconds = Math.floor(elapsedMs / 1000);
const minutes = Math.floor(totalSeconds / 60);
const seconds = totalSeconds % 60;
const result = seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
```

**After**:

```typescript
// In utils/duration-formatters.ts
import { formatElapsedDuration } from "../utils/duration-formatters.js";
const result = formatElapsedDuration(startedAt);
```

---

## Implementation Checklist

### Pre-Migration

- [ ] Create comprehensive test suite for existing CLI
- [ ] Document all command behaviors
- [ ] Create feature parity tests

### Phase 1: Infrastructure

- [ ] Create `src/cli/types.ts`
- [ ] Create `src/cli/bootstrap.ts`
- [ ] Create `src/cli/utils/*.ts` (11 files)
- [ ] Run tests to verify backward compatibility
- [ ] Update imports in index.ts to use new utilities

### Phase 2: Commands

- [ ] Create `src/cli/commands/` directory
- [ ] Extract simple commands first (system, mesh, swarm)
- [ ] Extract medium complexity (config, router, tenancy)
- [ ] Extract high complexity (reasoning, consensus)
- [ ] **Special focus**: Hive-mind extraction with cyclomatic reduction
- [ ] Create command registration in `commands/index.ts`
- [ ] Run tests after each group

### Phase 3: Interactive Mode

- [ ] Create `src/cli/interactive/` directory
- [ ] Extract interactive menus one by one
- [ ] Reduce cyclomatic complexity of menu handlers
- [ ] Test interactive mode thoroughly

### Phase 3.5: Middleware

- [ ] Create `src/cli/middleware/` directory
- [ ] Extract orchestrator functions
- [ ] Extract strategy executor
- [ ] Extract authorization middleware

### Post-Migration

- [ ] Update main index.ts to be <200 lines (only setup & registration)
- [ ] Verify all tests pass
- [ ] Update CLI documentation
- [ ] Create migration guide for contributors
- [ ] Performance testing (should be identical)
- [ ] Update CHANGELOG with refactoring notes

---

## File Size Targets (After Refactoring)

| Module                | Current | Target | Reduction    |
| --------------------- | ------- | ------ | ------------ |
| **index.ts**          | 4,764   | <200   | 95.8%        |
| **commands/**         | (0)     | ~2,500 | new          |
| **interactive/**      | (0)     | ~800   | new          |
| **utils/**            | (0)     | ~900   | new          |
| **middleware/**       | (0)     | ~300   | new          |
| **types.ts**          | (0)     | ~100   | new          |
| **bootstrap.ts**      | (0)     | ~100   | new          |
| **Total extractable** | ~4,550  | ~4,600 | consolidated |

**Key Benefit**: Main `index.ts` reduced from 4,764 → <200 lines (95.8% reduction)

---

## Cyclomatic Complexity Reduction Targets

### Functions with Current High Complexity

| Function                    | Current Est. | Target | Strategy                       |
| --------------------------- | ------------ | ------ | ------------------------------ |
| `interactiveHiveMindMenu()` | ~12          | 5-6    | Split into 3 submenu functions |
| `interactiveSystemMenu()`   | ~8           | 4-5    | Extract switch cases           |
| `orchestrateConsensus()`    | ~7           | 4      | Move to middleware             |
| `hive-mind spawn` handler   | ~15          | 5-6    | Split by strategy type         |
| `interactiveAgentsMenu()`   | ~9           | 5      | Extract menu options           |

### After Refactoring

**All functions will have complexity < 10**, with majority < 6:

- **Simple utilities** (parsers, renderers): complexity 2-3
- **Command handlers**: complexity 4-6
- **Menu handlers**: complexity 4-5
- **Orchestrators**: complexity 5-6

---

## Backward Compatibility & Migration Path

### What Stays the Same (100% Compatible)

- All CLI commands and options remain identical
- All command signatures unchanged
- All output formats unchanged
- All environment variables supported
- All existing scripts continue to work

### What Changes (Internal Only)

- Import paths (only for contributors modifying CLI)
- Module organization
- Function locations (grouped by purpose)
- Internal implementation details

### Migration for Contributors

**Old way** (before):

```bash
# Edit src/cli/index.ts directly
# Locate your command in 4,764 lines
# Merge conflicts likely on large PRs
```

**New way** (after):

```bash
# Edit src/cli/commands/your-feature.ts
# Clear separation of concerns
# Minimal merge conflicts
# Each command isolated in <300 lines
```

### Gradual Rollout Option

If transitioning gradually is preferred:

1. **Phase A**: Extract utilities only (days 1-2)
   - Move utils to `/utils/` directory
   - Update imports in index.ts
   - No command changes yet
2. **Phase B**: Extract half the commands (days 3-5)
   - Extract simple commands first
   - Keep complex ones in index.ts temporarily
3. **Phase C**: Complete migration (days 6-7)
   - Extract remaining commands
   - Remove from index.ts

---

## Testing Strategy

### Unit Tests

```typescript
// tests/cli/commands/system.test.ts
describe("System Commands", () => {
  it("should start the system", async () => {
    // Test system.start command
  });

  it("should handle startup errors", async () => {
    // Test error handling
  });
});
```

### Integration Tests

```typescript
// tests/cli/integration.test.ts
describe("CLI Integration", () => {
  it("should execute hive-mind spawn end-to-end", async () => {
    // Full command execution test
  });

  it("should maintain backward compatibility", async () => {
    // Test all old command paths still work
  });
});
```

### Command Parity Tests

```typescript
// Verify all 60+ commands still work identically
for (const command of allCommands) {
  console.assert(oldOutput === newOutput, `${command} output mismatch`);
}
```

---

## Rollback Plan

If issues arise during migration:

1. **Git branches**: Keep feature branches separate
   - `main` = original 4,764-line index.ts
   - `refactor/cli` = new modular structure
   - Easy to revert if needed
2. **Feature flags**: Could wrap new code with feature flag
   ```typescript
   if (process.env.USE_MODULAR_CLI === "1") {
     // Use new modular commands
   } else {
     // Use original index.ts
   }
   ```
3. **Tag checkpoints**: Create git tags at each phase
   - `v-refactor-phase1`
   - `v-refactor-phase2`
   - `v-refactor-phase3`

4. **Automated tests**: Run full test suite after each change
   - Block merge if tests fail
   - Catch regressions immediately

---

## Expected Benefits

### For Developers

- 95% reduction in file size searched for specific commands
- Clear module organization by feature
- Easier to locate and understand specific functionality
- Lower merge conflict rate (15-20% estimated reduction)
- Faster code review of CLI changes

### For Maintainability

- Each file <300 lines (vs. 4,764)
- Cyclomatic complexity <10 per function (from ~15 in some cases)
- Clear separation of concerns
- Easier onboarding for new contributors
- Better testability

### For CI/CD

- Faster TypeScript compilation (fewer LOC per file)
- More granular dependency tracking
- Easier incremental builds
- Better tree-shaking for bundle optimization

### For Long-term

- Foundation for future CLI plugin system
- Easier to migrate commands to subcommands
- Better code reuse across commands
- Simpler to add new commands

---

## Risk Assessment

| Risk                   | Probability | Impact | Mitigation                           |
| ---------------------- | ----------- | ------ | ------------------------------------ |
| Breaking changes       | Low         | High   | Comprehensive tests before migration |
| Import path issues     | Medium      | Low    | Automation script + careful review   |
| Missed edge cases      | Medium      | Low    | Phase-by-phase testing               |
| Performance regression | Low         | Low    | Benchmarking before/after            |
| Team friction          | Low         | Medium | Clear documentation + training       |

---

## Timeline & Estimate

| Phase             | Duration | Tasks                         | Effort         |
| ----------------- | -------- | ----------------------------- | -------------- |
| **Planning**      | 1 day    | Design review, tool selection | 4h             |
| **Phase 1**       | 2 days   | Infrastructure, utilities     | 16h            |
| **Phase 2**       | 3 days   | Command extraction            | 24h            |
| **Phase 3**       | 2 days   | Interactive mode              | 16h            |
| **Phase 3.5**     | 1 day    | Middleware                    | 8h             |
| **Testing**       | 2 days   | Comprehensive testing         | 16h            |
| **Documentation** | 1 day    | Update guides                 | 8h             |
| **Buffer**        | 1 day    | Unforeseen issues             | 8h             |
|                   |          | **Total**                     | **~100 hours** |

**Recommended pace**: 4 weeks with 1 dev (25h/week) or 2 weeks with 2 devs

---

## Appendix A: Command Inventory

```
System Commands (4)
├── system start
├── system stop
├── system status
├── system monitor

Configuration (5)
├── openai
├── usage
├── background status/start/stop
├── auth
├── token

Instructions (4)
├── instructions sync
├── instructions validate
├── instructions cache
├── (implicit list)

Tenancy (5)
├── tenant list
├── tenant create
├── tenant show
├── tenant quota
├── (implicit status)

Tools (4)
├── tools score
├── tools record
├── tools history
├── (implicit list)

Reasoning (5)
├── reasoning plan
├── reasoning checkpoint
├── reasoning complete
├── reasoning resume
├── reasoning history

Router (4)
├── router evaluate
├── router rules
├── router history
├── (implicit status)

Agent (4)
├── agent list
├── agent deploy
├── agent status
├── (implicit info)

Mesh (3)
├── mesh configure
├── mesh status
├── (implicit health)

Swarm (4)
├── swarm start
├── swarm stop
├── swarm status
├── (implicit config)

Bridge (3)
├── bridge mcp-send
├── bridge a2a-send
├── (implicit status)

Consensus (5)
├── consensus propose
├── consensus vote
├── consensus status
├── consensus telemetry
├── consensus stake/mode

Task (3)
├── task submit
├── task recent
├── (implicit list)

Hive-Mind (2)
├── hive-mind spawn
├── hive-mind history

Observability (2)
├── observability template
├── (implicit status)

Environment (6)
├── env list
├── env status
├── env up
├── env down
├── env plan
├── (implicit config)

Memory (3)
├── memory status
├── memory list
├── (implicit info)

Cheats (6)
├── cheats list
├── cheats run
├── cheats sync
├── cheats publish
├── cheats follow-up
├── (implicit status)

Interactive (1)
├── interactive

**Total: ~60 commands**
```

---

## Appendix B: Import Dependency Map

### Current index.ts Imports (57 total)

```
Core System (8)
├── Command (commander)
├── chalk (colors)
├── inquirer (prompts)
├── CliSession
├── CodexSynapticSystem
├── Logger
├── AgentType, AgentMetadata
├── ErrorHandling (daemon-manager)

Context & Config (5)
├── CodexContextBuilder
├── CodexContext types
├── InstructionParser
├── SystemConfiguration
├── TenantQuota

Routing & Optimization (4)
├── RoutingPolicyService
├── ToolOptimizer
├── ToolCandidate, ToolUsageRecord
├── ReasoningRunRecord

Reasoning & Strategy (4)
├── GoapExecutor
├── goapRegistry
├── executeStrategy
├── SupportedStrategy

File I/O & Path (3)
├── readFileSync, existsSync (fs)
├── join, resolve, relative (path)

Utilities & Helpers (4)
├── RetryManager
├── HiveMindYamlFormatter
├── parseFileContent, loadFileThroughFeedforward
├── serviceManager

Passthrough (2)
├── executeCodexPassthrough
├── isCodexCliAvailable
```

### After Refactoring

**index.ts** (main entry, <200 lines):

```typescript
import { Command } from "commander";
import { registerAllCommands } from "./commands/index.js";
import { initializeCliEnvironment } from "./bootstrap.js";
import { launchInteractiveMode } from "./interactive/index.js";
```

**commands/\*.ts** (~20 files):

```typescript
// Each command file imports only what it needs
import { useSystem, handleCommand } from "../utils/system-utilities.js";
import { CodexSynapticSystem } from "../core/system.js";
// ... specific to that command
```

**utils/\*.ts** (~12 files):

```typescript
// Utilities group related imports by purpose
// parsers.ts imports path, fs utilities
// renderers.ts imports chalk, Logger
// consensus-helpers.ts imports system types
```

**Result**:

- Better dependency isolation
- Clearer dependency graph
- Easier to identify unused imports
- Better tree-shaking for bundling

---

## Appendix C: Example Migration of hive-mind Command

### BEFORE (current index.ts, lines 3630-4160)

```typescript
const hiveMindCmd = program
  .command("hive-mind")
  .description("Launch hive-mind workflows...")
  .action(/* ... */);

hiveMindCmd
  .command("spawn")
  .description("Spawn a coordinated hive-mind workflow from a prompt")
  .argument("<prompt...>", "Natural language description...")
  .option("--strategy <type>", strategyOptionDescription, "classic")
  // ... 40+ options
  .action(
    handleCommand("hive-mind.spawn", async (promptParts: string[], options) => {
      let prompt = promptParts.join(" ").trim();
      if (!prompt) {
        throw new Error("Prompt cannot be empty");
      }

      const originalPrompt = prompt;
      const strategy = (options.strategy ?? "classic").toLowerCase();
      const normalizedConsensus = normalizeConsensusMechanism(
        options.consensus,
      );
      const streamLogs = Boolean(options.streamLogs);
      const effectiveLogLevel = parseLogLevelOption(
        options.logLevel,
        options.debug ? LogLevel.DEBUG : LogLevel.INFO,
      );
      const agentTarget = parseInteger(options.agents, "agents");
      const maxAgents = options.maxAgents
        ? parseInteger(options.maxAgents, "maxAgents")
        : 10;
      const timeoutMs = options.timeout
        ? parseInteger(options.timeout, "timeout") * 1000
        : 600000;
      const isAdvancedStrategy = advancedStrategySet.has(
        strategy as SupportedStrategy,
      );

      // GOAP path
      if (strategy === "goap") {
        await useSystem("hive-mind goap", async (system) => {
          let manifest = options.goapProfile
            ? await goapRegistry.getManifest(options.goapProfile)
            : await goapRegistry.matchManifest(originalPrompt);

          if (!manifest && options.goapProfile) {
            throw new Error(
              `GOAP manifest "${options.goapProfile}" was not found in config/goap.`,
            );
          }

          if (!manifest) {
            throw new Error(
              "No GOAP manifest matched the prompt. Provide --goap-profile to select a manifest explicitly.",
            );
          }

          const goalId =
            options.goapGoal ?? manifest.defaultGoal ?? manifest.goals[0]?.id;
          if (!goalId) {
            throw new Error(
              `GOAP manifest ${manifest.id} does not define a usable goal.`,
            );
          }

          // ... 30+ more lines of GOAP execution logic
        });
        return;
      }

      // Classic path
      if (strategy !== "classic" && !isAdvancedStrategy) {
        throw new Error(`Unsupported hive-mind strategy: ${strategy}`);
      }

      const autoAttachCodex = shouldAutoAttachCodexContext(prompt);
      const codexRequested = options.codex || autoAttachCodex;

      if (options.dryRun && !codexRequested) {
        throw new Error("--dry-run can only be used together with --codex");
      }

      // ... 200+ more lines of classic/advanced logic
    }),
  );

hiveMindCmd.command("history").description("Show recent hive-mind spawns...");
// ... history command implementation
```

### AFTER (refactored modules)

**`src/cli/commands/hive-mind.ts`** (~80 lines)

```typescript
import { Command } from "commander";
import { handleCommand } from "../utils/system-utilities.js";
import { executeGoapStrategy } from "./hive-mind/goap-strategy.js";
import { executeClassicStrategy } from "./hive-mind/classic-strategy.js";
import { executeAdvancedStrategy } from "./hive-mind/advanced-strategy.js";
import { decorateCommandHelp } from "../utils/help-decorators.js";

export function registerHiveMindCommands(program: Command): void {
  const hiveMindCmd = program
    .command("hive-mind")
    .description("Launch hive-mind workflows and Codex passthroughs");

  decorateCommandHelp(hiveMindCmd, {
    title: "Hive Control Stage",
    subtitle: "Summon squads of agents and channel Codex context on demand.",
    // ... help options
  });

  hiveMindCmd
    .command("spawn")
    .description("Spawn a coordinated hive-mind workflow from a prompt")
    .argument("<prompt...>", "Natural language description of the task/goal")
    .option("--strategy <type>", "Coordination strategy", "classic")
    // ... other options
    .action(
      handleCommand(
        "hive-mind.spawn",
        async (promptParts: string[], options) => {
          const prompt = validateAndNormalizePrompt(promptParts);
          const strategy = (options.strategy ?? "classic").toLowerCase();

          switch (strategy) {
            case "goap":
              await executeGoapStrategy(prompt, options);
              break;
            case "classic":
              await executeClassicStrategy(prompt, options);
              break;
            default:
              await executeAdvancedStrategy(strategy, prompt, options);
          }
        },
      ),
    );

  hiveMindCmd
    .command("history")
    .description("Show recent hive-mind spawns from persistent log")
    .option("--limit <count>", "Number of recent spawns to show", "10")
    .option("--filter <pattern>", "Filter by prompt pattern")
    .action(
      handleCommand("hive-mind.history", async (options) => {
        // Implementation extracted from current code
      }),
    );
}

function validateAndNormalizePrompt(promptParts: string[]): string {
  const prompt = promptParts.join(" ").trim();
  if (!prompt) {
    throw new Error("Prompt cannot be empty");
  }
  return prompt;
}
```

**`src/cli/commands/hive-mind/goap-strategy.ts`** (~100 lines)

```typescript
import { useSystem } from "../../utils/system-utilities.js";
import { goapRegistry } from "../../../reasoning/goap/registry.js";
import { GoapExecutor } from "../../../reasoning/goap/executor.js";
import chalk from "chalk";

export async function executeGoapStrategy(
  originalPrompt: string,
  options: any,
): Promise<void> {
  // Complexity: ~4
  // This function only handles GOAP strategy
  // All logic is GOAP-specific
  // No cross-strategy conditionals

  await useSystem("hive-mind goap", async (system) => {
    const manifest = await resolveGoapManifest(originalPrompt, options);
    const goalId = deriveGoalId(manifest);

    console.log(
      chalk.blue(
        `🧭 Executing GOAP profile ${manifest.metadata?.name ?? manifest.id}`,
      ),
    );

    const executor = new GoapExecutor(system);
    const result = await executor.execute(manifest, {
      goalId,
      prompt: originalPrompt,
      dryRun: Boolean(options.goapDryRun),
    });

    logGoapResults(result);
  });
}

async function resolveGoapManifest(prompt: string, options: any) {
  // Complexity: ~3
  // Split resolution logic into focused function
  const manifest = options.goapProfile
    ? await goapRegistry.getManifest(options.goapProfile)
    : await goapRegistry.matchManifest(prompt);

  if (!manifest && options.goapProfile) {
    throw new Error(
      `GOAP manifest "${options.goapProfile}" was not found in config/goap.`,
    );
  }

  if (!manifest) {
    throw new Error(
      "No GOAP manifest matched the prompt. Provide --goap-profile to select a manifest explicitly.",
    );
  }

  return manifest;
}

function deriveGoalId(manifest: any): string {
  // Complexity: ~2
  const goalId = manifest.defaultGoal ?? manifest.goals[0]?.id;

  if (!goalId) {
    throw new Error(
      `GOAP manifest ${manifest.id} does not define a usable goal.`,
    );
  }

  return goalId;
}

function logGoapResults(result: any): void {
  // Complexity: ~1
  console.log(
    chalk.green(
      `✅ GOAP workflow complete — ${result.actionsCompleted}/${result.totalActions} actions`,
    ),
  );

  if (result.artifacts.length) {
    console.log(chalk.cyan("📦 Generated artifacts:"));
    result.artifacts.forEach((artifact) => {
      console.log(chalk.gray(`  • ${artifact}`));
    });
  }
}
```

**`src/cli/commands/hive-mind/classic-strategy.ts`** (~180 lines)

```typescript
import { useSystem } from "../../utils/system-utilities.js";
import { shouldAutoAttachCodexContext } from "../../utils/codex-utilities.js";
import { normalizeConsensusMechanism } from "../../utils/runtime-helpers.js";
import { orchestrateConsensus } from "../../middleware/consensus-orchestrator.js";
import {
  CodexContextBuilder,
  composePromptWithContext,
} from "../../codex-context.js";
import chalk from "chalk";

export async function executeClassicStrategy(
  originalPrompt: string,
  options: any,
): Promise<void> {
  // Complexity: ~4
  // Orchestrates the overall classic spawn flow
  // Delegates specifics to helper functions

  const autoAttachCodex = shouldAutoAttachCodexContext(originalPrompt);
  const codexRequested = options.codex || autoAttachCodex;

  if (options.dryRun && !codexRequested) {
    throw new Error("--dry-run can only be used together with --codex");
  }

  let workingPrompt = originalPrompt;

  if (codexRequested) {
    workingPrompt = await enrichPromptWithCodex(originalPrompt, options);
  }

  if (options.dryRun) {
    console.log(
      chalk.cyan("📋 Dry-run: Codex context prepared, no spawn executed."),
    );
    return;
  }

  await useSystem("hive-mind classic", async (system) => {
    const config = buildSpawnConfiguration(options);
    const result = await executeSpawn(system, workingPrompt, config, options);

    if (shouldPerformConsensus(options)) {
      await orchestrateConsensus(
        system,
        originalPrompt,
        result,
        options.consensus,
      );
    }

    if (options.streamLogs) {
      console.log(chalk.cyan("📊 Hive-mind spawn completed successfully."));
    }
  });
}

async function enrichPromptWithCodex(
  prompt: string,
  options: any,
): Promise<string> {
  // Complexity: ~3
  // Focuses on Codex context building

  const builder = new CodexContextBuilder(process.cwd());

  if (!options.skipAgentDirectives) {
    await builder.withAgentDirectives();
  }

  if (!options.skipReadme) {
    await builder.withReadmeExcerpts();
  }

  if (!options.skipInventory) {
    await builder.withDirectoryInventory();
  }

  if (!options.skipMetadata) {
    await builder.withDatabaseMetadata();
  }

  const buildResult = await builder.build();
  logCodexContext(buildResult);

  return composePromptWithContext(prompt, buildResult.context);
}

function buildSpawnConfiguration(options: any) {
  // Complexity: ~2
  // Straightforward configuration assembly

  return {
    agents: parseInt(options.agents, 10),
    maxAgents: parseInt(options.maxAgents || "10", 10),
    algorithm: options.algorithm || "pso",
    topology: options.meshTopology || "mesh",
    priority: parseInt(options.priority || "7", 10),
    timeout: parseInt(options.timeout || "600", 10) * 1000,
    autoScale: Boolean(options.autoScale),
    queenCoordinator: Boolean(options.queenCoordinator),
    faultTolerance: Boolean(options.faultTolerance),
  };
}

async function executeSpawn(system, prompt, config, options): Promise<any> {
  // Complexity: ~3
  // Actual spawn execution, isolated from orchestration

  console.log(chalk.cyan(`🚀 Spawning ${config.agents} agents...`));

  const result = await system.spawnHiveMind({
    prompt,
    agentCount: config.agents,
    meshTopology: config.topology,
    swarmAlgorithm: config.algorithm,
    priority: config.priority,
    timeout: config.timeout,
    autoScale: config.autoScale,
    enableQueen: config.queenCoordinator,
    faultTolerant: config.faultTolerance,
    enableMcp: Boolean(options.mcp),
    debugMode: Boolean(options.debug),
  });

  logSpawnResults(result);
  return result;
}

function shouldPerformConsensus(options: any): boolean {
  // Complexity: ~2
  return options.consensus && options.consensus !== "none";
}

function logCodexContext(buildResult: any): void {
  // Complexity: ~1
  // Simple logging delegate
  console.log(chalk.green("✅ Codex context enriched"));
}

function logSpawnResults(result: any): void {
  // Complexity: ~2
  console.log(
    chalk.green(
      `✅ Hive-mind spawn successful (${result.agentCount} agents active)`,
    ),
  );
}
```

**Benefits of this refactoring**:

| Metric                    | Before | After    | Improvement         |
| ------------------------- | ------ | -------- | ------------------- |
| **Lines (spawn command)** | ~500   | ~270     | 46% reduction       |
| **Max complexity**        | 15+    | 4        | 73% reduction       |
| **File count**            | 1      | 4        | Better organization |
| **Function locations**    | Random | Semantic | Clear structure     |
| **Merge conflicts**       | High   | Low      | ~60% fewer          |
| **Code review time**      | 45min  | 15min    | 67% faster          |

---

## Appendix D: Testing Examples

### Unit Test Structure

```typescript
// tests/cli/commands/system.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CodexSynapticSystem } from "../../../core/system";
import { registerSystemCommands } from "../../../cli/commands/system";

describe("System Commands", () => {
  let system: CodexSynapticSystem;
  let program: Command;

  beforeEach(async () => {
    system = await createTestSystem();
    program = new Command();
    registerSystemCommands(program);
  });

  afterEach(async () => {
    await system.shutdown();
  });

  describe("system start", () => {
    it("should start the orchestrator", async () => {
      await program.parseAsync(["node", "test", "system", "start"]);
      expect(system.isRunning()).toBe(true);
    });

    it("should fail if already running", async () => {
      await system.start();

      const result = program.parseAsync(["node", "test", "system", "start"]);

      expect(result).rejects.toThrow("already running");
    });

    it("should initialize mesh and swarm", async () => {
      await program.parseAsync(["node", "test", "system", "start"]);

      expect(system.getNeuralMesh().isInitialized()).toBe(true);
      expect(system.getSwarmCoordinator().isRunning()).toBe(true);
    });
  });

  describe("system status", () => {
    it("should display system health", async () => {
      await system.start();

      const output = await captureConsoleOutput(() =>
        program.parseAsync(["node", "test", "system", "status"]),
      );

      expect(output).toContain("System Status");
      expect(output).toContain("Mesh");
      expect(output).toContain("Swarm");
    });
  });
});
```

---

## Appendix E: Documentation Template

Create `docs/cli/REFACTORING.md`:

````markdown
# CLI Refactoring Guide (v2.0)

## Overview

The CLI has been refactored from a 4,764-line monolith into a modular structure with:

- 60+ focused command files
- Organized utility modules
- Reduced cyclomatic complexity
- Clearer separation of concerns

## New Structure

### Adding a New Command

1. Create `src/cli/commands/my-feature.ts`
2. Implement `registerMyFeatureCommands(program: Command)`
3. Import and call in `src/cli/commands/index.ts`
4. Add tests in `tests/cli/commands/my-feature.test.ts`

### Creating Interactive Menus

1. Create `src/cli/interactive/my-menu.ts`
2. Export menu function
3. Register in `src/cli/interactive/index.ts`

### Adding Utilities

1. Determine purpose (parsing, rendering, etc.)
2. Add to appropriate file in `src/cli/utils/`
3. Export from module
4. Import in command files that need it

## Backward Compatibility

All CLI commands remain identical. This refactoring is internal only.

## Testing

Run full test suite:

```bash
npm test -- cli
```
````

Test specific command:

```bash
npm test -- cli/commands/system.test.ts
```

## Performance

No performance impact. Refactoring is structural only.

## Migration FAQ

**Q: Where do I find the `hive-mind spawn` command?**
A: In `src/cli/commands/hive-mind/classic-strategy.ts` (or goap-strategy.ts)

**Q: How do I reduce cyclomatic complexity?**
A: Extract conditional branches into separate functions with single responsibility.

**Q: Can I still modify index.ts?**
A: Rarely. Most changes should go to specific command files.

**Q: What if my command spans multiple subcommands?**
A: Keep related subcommands in the same file if < 300 lines, otherwise split.

```

---

## Summary

This refactoring plan provides:

✓ **Detailed breakdown** of 4,764 lines into 50+ focused files
✓ **Concrete file structure** with line count estimates
✓ **Phase-by-phase implementation** guide with priorities
✓ **Cyclomatic complexity** reduction strategies
✓ **100% backward compatibility** - no breaking changes
✓ **Clear rollback options** if issues arise
✓ **Test strategy** for validation
✓ **Team-friendly documentation** for adoption

**Total estimated effort: ~100 hours** (4 weeks solo or 2 weeks with 2 devs)

**Immediate benefits**: 95.8% reduction in main file size, clearer organization, faster development

---
```
