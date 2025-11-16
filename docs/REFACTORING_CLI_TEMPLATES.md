# CLI Refactoring - Implementation Templates & Quick Start

This document provides ready-to-use templates for extracting CLI commands and utilities.

---

## Template 1: Simple Command File

Use this template for commands with <5 subcommands and <150 lines.

**File**: `src/cli/commands/mesh.ts`

```typescript
import { Command } from "commander";
import { useSystem } from "../utils/system-utilities.js";
import { handleCommand } from "../utils/system-utilities.js";
import { renderMeshStatus } from "../utils/renderers.js";
import { decorateCommandHelp } from "../utils/help-decorators.js";
import chalk from "chalk";

export function registerMeshCommands(program: Command): void {
  const meshCmd = program
    .command("mesh")
    .description("Configure and monitor neural mesh topology");

  decorateCommandHelp(meshCmd, {
    title: "Neural Mesh Control",
    subtitle: "Topology management and health monitoring.",
    context: [
      "The mesh coordinates agent communication patterns.",
      "Choose topology that matches your concurrency model.",
    ],
    skills: [
      "Understand mesh vs. ring vs. star topologies",
      "Monitor latency and message delivery",
    ],
    vibeTips: [
      "Think of mesh as a group conversation—everyone hears everyone.",
    ],
    actions: [
      {
        command: "codex-synaptic mesh configure --topology mesh",
        description: "Switch to full mesh topology",
      },
    ],
    docs: [{ label: "docs/mesh-topology.md", description: "Topology guide" }],
  });

  meshCmd
    .command("configure")
    .description("Configure mesh topology")
    .option(
      "--topology <type>",
      "Topology type (mesh|ring|star|hierarchical)",
      "mesh",
    )
    .option("--max-connections <num>", "Maximum connections per node", "16")
    .action(
      handleCommand("mesh.configure", async (options) => {
        await useSystem("mesh configure", async (system) => {
          const mesh = system.getNeuralMesh();

          await mesh.reconfigure({
            topology: options.topology,
            maxConnections: parseInt(options.maxConnections, 10),
          });

          console.log(
            chalk.green(`✓ Mesh configured with ${options.topology} topology`),
          );
        });
      }),
    );

  meshCmd
    .command("status")
    .description("Show mesh status and diagnostics")
    .option("--detailed", "Show detailed per-node information")
    .action(
      handleCommand("mesh.status", async (options) => {
        await useSystem("mesh status", async (system) => {
          const status = system.getNeuralMesh().getStatus();

          renderMeshStatus(status);

          if (options.detailed) {
            // Additional detailed output
            console.log(chalk.gray("\nPer-node details:"));
            status.nodes?.forEach((node) => {
              console.log(`  ${node.id}: ${node.state}`);
            });
          }
        });
      }),
    );
}
```

---

## Template 2: Medium Complexity Command File

Use this template for commands with 5-10 subcommands or complex logic.

**File**: `src/cli/commands/tenancy.ts`

```typescript
import { Command } from "commander";
import { useSystem } from "../utils/system-utilities.js";
import { handleCommand } from "../utils/system-utilities.js";
import { authorizeTenantAction } from "../middleware/tenancy-authorizer.js";
import { decorateCommandHelp } from "../utils/help-decorators.js";
import chalk from "chalk";
import inquirer from "inquirer";

export function registerTenancyCommands(program: Command): void {
  const tenantCmd = program
    .command("tenant")
    .description("Multi-tenancy management");

  decorateCommandHelp(tenantCmd, {
    title: "Tenancy Control",
    subtitle: "Manage isolated workspaces and resource quotas.",
    context: [
      "Each tenant has isolated agent pools and resource limits.",
      "Perfect for SaaS deployments with multiple customers.",
    ],
    skills: [
      "Understand tenant isolation boundaries",
      "Configure quotas per tenant",
    ],
    vibeTips: ["Think of tenants as separate clubs with their own rules."],
    actions: [
      {
        command: "codex-synaptic tenant create --id acme-corp",
        description: "Create a new tenant workspace",
      },
    ],
    docs: [{ label: "docs/multi-tenancy.md", description: "Tenancy guide" }],
  });

  tenantCmd
    .command("list")
    .description("List all tenants")
    .option("--format <type>", "Output format (table|json)", "table")
    .action(
      handleCommand("tenant.list", async (options) => {
        await useSystem("tenant list", async (system) => {
          const tenants = await system.getTenantManager().listTenants();

          if (options.format === "json") {
            console.log(JSON.stringify(tenants, null, 2));
          } else {
            console.table(tenants);
          }
        });
      }),
    );

  tenantCmd
    .command("create")
    .description("Create a new tenant")
    .option("--id <tenantId>", "Unique tenant identifier")
    .option("--name <name>", "Display name")
    .option("--max-agents <count>", "Maximum agents for this tenant", "10")
    .action(
      handleCommand("tenant.create", async (options) => {
        await authorizeTenantAction(
          null as any, // System will be obtained from useSystem
          "write",
        );

        let tenantId = options.id;

        if (!tenantId) {
          const { id } = await inquirer.prompt([
            {
              type: "input",
              name: "id",
              message: "Enter tenant ID:",
              validate: (v) => v.length > 0 || "ID cannot be empty",
            },
          ]);
          tenantId = id;
        }

        await useSystem("tenant create", async (system) => {
          const manager = system.getTenantManager();

          const tenant = await manager.createTenant({
            id: tenantId,
            name: options.name || tenantId,
            maxAgents: parseInt(options.maxAgents, 10),
          });

          console.log(
            chalk.green(`✓ Tenant "${tenantId}" created successfully`),
          );
          console.log(`  ID: ${tenant.id}`);
          console.log(`  Max Agents: ${tenant.maxAgents}`);
        });
      }),
    );

  tenantCmd
    .command("show")
    .description("Show tenant details")
    .argument("<tenantId>", "Tenant identifier")
    .action(
      handleCommand("tenant.show", async (tenantId) => {
        await useSystem("tenant show", async (system) => {
          const manager = system.getTenantManager();
          const tenant = await manager.getTenant(tenantId);

          if (!tenant) {
            throw new Error(`Tenant "${tenantId}" not found`);
          }

          console.log(chalk.cyan(`Tenant: ${tenant.id}`));
          console.log(`  Name: ${tenant.name}`);
          console.log(`  Max Agents: ${tenant.maxAgents}`);
          console.log(`  Active Agents: ${tenant.activeAgents}`);
        });
      }),
    );

  tenantCmd
    .command("quota")
    .description("Show/update tenant quota")
    .argument("<tenantId>", "Tenant identifier")
    .option("--max-agents <count>", "Update max agents")
    .option("--max-memory <mb>", "Update max memory (MB)")
    .action(
      handleCommand("tenant.quota", async (tenantId, options) => {
        await useSystem("tenant quota", async (system) => {
          const manager = system.getTenantManager();
          const tenant = await manager.getTenant(tenantId);

          if (!tenant) {
            throw new Error(`Tenant "${tenantId}" not found`);
          }

          if (options.maxAgents) {
            await manager.updateQuota(tenantId, {
              maxAgents: parseInt(options.maxAgents, 10),
            });
            console.log(
              chalk.green(`✓ Updated max agents to ${options.maxAgents}`),
            );
          }

          const quota = await manager.getQuota(tenantId);
          console.log(chalk.cyan("\nCurrent Quota:"));
          console.log(`  Max Agents: ${quota.maxAgents}`);
          console.log(`  Used Agents: ${quota.usedAgents}`);
        });
      }),
    );
}
```

---

## Template 3: Complex Command File with Helper Functions

Use this template for commands with complex business logic.

**File**: `src/cli/commands/reasoning.ts`

```typescript
import { Command } from "commander";
import { useSystem } from "../utils/system-utilities.js";
import { handleCommand } from "../utils/system-utilities.js";
import { decorateCommandHelp } from "../utils/help-decorators.js";
import chalk from "chalk";

export function registerReasoningCommands(program: Command): void {
  const reasoningCmd = program
    .command("reasoning")
    .description("Reasoning system and planning controls");

  decorateCommandHelp(reasoningCmd, {
    title: "Reasoning Control",
    subtitle: "Plan, execute, and resume reasoning chains.",
    context: ["Reasoning captures agent decision-making patterns."],
    skills: ["Create reasoning plans", "Monitor execution"],
    vibeTips: [],
    actions: [],
    docs: [{ label: "docs/reasoning.md", description: "Reasoning guide" }],
  });

  reasoningCmd
    .command("plan")
    .description("Create a reasoning plan")
    .option("--strategy <type>", "Strategy type", "classic")
    .option("--verbose", "Verbose output")
    .action(
      handleCommand("reasoning.plan", async (options) => {
        await useSystem("reasoning plan", async (system) => {
          const plan = await createReasoningPlan(system, options);

          console.log(chalk.green("✓ Plan created"));
          console.log(`  ID: ${plan.id}`);
          console.log(`  Steps: ${plan.steps.length}`);

          if (options.verbose) {
            console.log("\nSteps:");
            plan.steps.forEach((step, i) => {
              console.log(`  ${i + 1}. ${step.description}`);
            });
          }
        });
      }),
    );

  reasoningCmd
    .command("checkpoint")
    .description("Create a reasoning checkpoint")
    .argument("<planId>", "Plan identifier")
    .action(
      handleCommand("reasoning.checkpoint", async (planId) => {
        await useSystem("reasoning checkpoint", async (system) => {
          const checkpoint = await createCheckpoint(system, planId);

          console.log(chalk.green("✓ Checkpoint created"));
          console.log(`  Checkpoint ID: ${checkpoint.id}`);
        });
      }),
    );

  reasoningCmd
    .command("complete")
    .description("Complete a reasoning step")
    .argument("<planId>", "Plan identifier")
    .argument("<stepId>", "Step identifier")
    .action(
      handleCommand("reasoning.complete", async (planId, stepId) => {
        await useSystem("reasoning complete", async (system) => {
          const result = await completeReasoningStep(system, planId, stepId);

          console.log(chalk.green("✓ Step completed"));
          console.log(`  Result: ${result.outcome}`);
        });
      }),
    );

  reasoningCmd
    .command("resume")
    .description("Resume a paused reasoning plan")
    .argument("<planId>", "Plan identifier")
    .action(
      handleCommand("reasoning.resume", async (planId) => {
        await useSystem("reasoning resume", async (system) => {
          await resumeReasoningPlan(system, planId);

          console.log(chalk.green("✓ Plan resumed"));
        });
      }),
    );

  reasoningCmd
    .command("history")
    .description("Show reasoning history")
    .option("--limit <count>", "Number of records", "10")
    .action(
      handleCommand("reasoning.history", async (options) => {
        await useSystem("reasoning history", async (system) => {
          const history = await getReasoningHistory(
            system,
            parseInt(options.limit, 10),
          );

          console.log(chalk.cyan("Recent Reasoning Plans:"));
          history.forEach((record) => {
            console.log(
              `  ${record.id}: ${record.status} (${record.steps.length} steps)`,
            );
          });
        });
      }),
    );
}

// Helper functions (keep these focused and testable)

async function createReasoningPlan(system: any, options: any): Promise<any> {
  // Extract from current index.ts implementation
  // Keep this function focused
  // Return the created plan
}

async function createCheckpoint(system: any, planId: string): Promise<any> {
  // Extract checkpoint creation logic
}

async function completeReasoningStep(
  system: any,
  planId: string,
  stepId: string,
): Promise<any> {
  // Extract step completion logic
}

async function resumeReasoningPlan(system: any, planId: string): Promise<void> {
  // Extract resume logic
}

async function getReasoningHistory(system: any, limit: number): Promise<any[]> {
  // Extract history retrieval logic
}
```

---

## Template 4: Utility Module

Use this template for utility modules in `src/cli/utils/`.

**File**: `src/cli/utils/duration-formatters.ts`

```typescript
/**
 * Duration and time formatting utilities
 */

/**
 * Format milliseconds as human-readable duration
 * @param startedAt Unix timestamp (ms) when operation started
 * @returns Formatted duration string (e.g., "2m 30s")
 */
export function formatElapsedDuration(startedAt: number): string {
  const elapsedMs = Date.now() - startedAt;

  if (elapsedMs < 1000) {
    return `${elapsedMs}ms`;
  }

  const totalSeconds = Math.floor(elapsedMs / 1000);

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes < 60) {
    return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;

  return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

/**
 * Format bytes as human-readable size
 * @param bytes Number of bytes
 * @returns Formatted size string (e.g., "1.5 MB")
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return (bytes / Math.pow(k, i)).toFixed(2) + " " + sizes[i];
}

/**
 * Format a number as a percentage
 * @param value Current value
 * @param total Total value
 * @returns Formatted percentage string
 */
export function formatPercentage(value: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}
```

---

## Template 5: Interactive Menu Module

Use this template for interactive menu functions in `src/cli/interactive/`.

**File**: `src/cli/interactive/mesh-menu.ts`

```typescript
import chalk from "chalk";
import inquirer from "inquirer";
import { ensureInteractiveSystem } from "../utils/interactive-helpers.js";
import { renderMeshStatus } from "../utils/renderers.js";

export async function showMeshMenu(): Promise<void> {
  let exit = false;

  while (!exit) {
    const system = await ensureInteractiveSystem();

    const { action } = await inquirer.prompt<{ action: string }>([
      {
        type: "list",
        name: "action",
        message: "Mesh controls:",
        choices: [
          {
            name: `${chalk.green("Status")} — View current topology`,
            value: "status",
            short: "Status",
          },
          {
            name: `${chalk.cyan("Configure")} — Change topology type`,
            value: "configure",
            short: "Configure",
          },
          {
            name: `${chalk.yellow("Diagnostics")} — Network health check`,
            value: "diag",
            short: "Diagnostics",
          },
          {
            name: "Back to main menu",
            value: "back",
            short: "Back",
          },
        ],
      },
    ]);

    switch (action) {
      case "status":
        await handleStatus(system);
        break;
      case "configure":
        await handleConfigure(system);
        break;
      case "diag":
        await handleDiagnostics(system);
        break;
      case "back":
        exit = true;
        break;
    }

    if (!exit && action !== "back") {
      await pause();
    }
  }
}

async function handleStatus(system: any): Promise<void> {
  const status = system.getNeuralMesh().getStatus();

  console.log("");
  renderMeshStatus(status);
  console.log("");
}

async function handleConfigure(system: any): Promise<void> {
  const { topology } = await inquirer.prompt<{ topology: string }>([
    {
      type: "list",
      name: "topology",
      message: "Select mesh topology:",
      choices: [
        { name: "Full Mesh", value: "mesh" },
        { name: "Ring", value: "ring" },
        { name: "Star", value: "star" },
        { name: "Hierarchical", value: "hierarchical" },
      ],
      default: "mesh",
    },
  ]);

  const mesh = system.getNeuralMesh();
  await mesh.reconfigure({ topology });

  console.log(chalk.green(`✓ Mesh reconfigured to ${topology} topology`));
}

async function handleDiagnostics(system: any): Promise<void> {
  console.log(chalk.cyan("Running mesh diagnostics..."));

  const diagnostics = await system.getNeuralMesh().runDiagnostics();

  console.log(chalk.cyan("\nDiagnostic Results:"));
  console.log(`  Latency: ${diagnostics.latency}ms`);
  console.log(`  Packet Loss: ${diagnostics.packetLoss}%`);
  console.log(`  Status: ${diagnostics.healthy ? "HEALTHY" : "DEGRADED"}`);
}

async function pause(message = "Press Enter to continue."): Promise<void> {
  await inquirer.prompt([
    {
      type: "input",
      name: "_",
      message,
    },
  ]);
}
```

---

## Quick Command Extraction Checklist

### Step 1: Identify Command Group

- [ ] List all subcommands in the group
- [ ] Estimate total lines of code
- [ ] Identify shared utilities used
- [ ] Note any complex functions

### Step 2: Create File

```bash
touch src/cli/commands/my-feature.ts
```

### Step 3: Create Registration Function

```typescript
export function registerMyFeatureCommands(program: Command): void {
  const cmd = program.command("my-feature");
  // Add subcommands here
}
```

### Step 4: Extract Command Implementations

- Copy subcommand definitions from index.ts
- Copy helper functions to separate functions in the file
- Update imports to use utilities from `/utils/`

### Step 5: Register in commands/index.ts

```typescript
import { registerMyFeatureCommands } from "./my-feature.js";

export function registerAllCommands(program: Command): void {
  // ... other registrations
  registerMyFeatureCommands(program);
}
```

### Step 6: Test

```bash
npm test -- cli/commands/my-feature.test.ts
npm run cli my-feature --help
```

---

## Utility Extraction Checklist

### Step 1: Identify Utility Purpose

- Parse functions → `parsers.ts`
- Rendering functions → `renderers.ts`
- Help/decoration → `help-decorators.ts`
- System interaction → `system-utilities.ts`
- Consensus logic → `consensus-helpers.ts`
- Duration formatting → `duration-formatters.ts`
- Interactive helpers → `interactive-helpers.ts`
- Codex logic → `codex-utilities.ts`
- Context logging → `context-loggers.ts`
- Background jobs → `background-jobs.ts`

### Step 2: Create File

```bash
touch src/cli/utils/my-utility.ts
```

### Step 3: Export Functions

```typescript
export function myUtilityFunction(input: string): string {
  // Implementation
}

export function anotherUtility(): void {
  // Implementation
}
```

### Step 4: Import in Commands

```typescript
import { myUtilityFunction, anotherUtility } from "../utils/my-utility.js";
```

### Step 5: Test

```bash
npm test -- cli/utils/my-utility.test.ts
```

---

## Complexity Reduction Patterns

### Pattern A: Replace Large If-Else with Switch + Delegation

**Before:**

```typescript
if (strategy === "a") {
  // 50 lines
} else if (strategy === "b") {
  // 60 lines
} else if (strategy === "c") {
  // 40 lines
}
```

**After:**

```typescript
const handlers = {
  a: handleStrategyA,
  b: handleStrategyB,
  c: handleStrategyC,
};

const handler = handlers[strategy] || handleUnknown;
await handler(input);
```

### Pattern B: Extract Switch Cases into Functions

**Before:**

```typescript
while (true) {
  const { action } = await prompt([...]);

  switch (action) {
    case 'opt1':
      // 30 lines
    case 'opt2':
      // 40 lines
    case 'opt3':
      // 25 lines
  }
}
```

**After:**

```typescript
while (true) {
  const { action } = await prompt([...]);

  switch (action) {
    case 'opt1': return await handleOpt1();
    case 'opt2': return await handleOpt2();
    case 'opt3': return await handleOpt3();
  }
}

async function handleOpt1(): Promise<void> { /* ... */ }
async function handleOpt2(): Promise<void> { /* ... */ }
async function handleOpt3(): Promise<void> { /* ... */ }
```

### Pattern C: Extract Validation into Separate Function

**Before:**

```typescript
if (!value) throw new Error("Required");
if (value.length < 3) throw new Error("Too short");
if (!/^[a-z]/.test(value)) throw new Error("Must start with letter");
if (!value.includes("-")) throw new Error("Must include dash");
```

**After:**

```typescript
function validateValue(value: string): void {
  if (!value) throw new Error("Required");
  if (value.length < 3) throw new Error("Too short");
  if (!/^[a-z]/.test(value)) throw new Error("Must start with letter");
  if (!value.includes("-")) throw new Error("Must include dash");
}

validateValue(value); // Single call, complexity hidden
```

---

## Testing Templates

### Command Test Template

```typescript
// tests/cli/commands/mesh.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerMeshCommands } from "../../../cli/commands/mesh";
import { Command } from "commander";
import { createTestSystem } from "../../fixtures/system";

describe("Mesh Commands", () => {
  let system: any;
  let program: Command;

  beforeEach(async () => {
    system = await createTestSystem();
    program = new Command();
    registerMeshCommands(program);
  });

  afterEach(async () => {
    await system.shutdown();
  });

  it("should show mesh status", async () => {
    const output = captureOutput(() =>
      program.parseAsync(["node", "test", "mesh", "status"]),
    );

    expect(output).toContain("Mesh Status");
  });

  it("should configure topology", async () => {
    await program.parseAsync([
      "node",
      "test",
      "mesh",
      "configure",
      "--topology",
      "ring",
    ]);

    const status = system.getNeuralMesh().getStatus();
    expect(status.topology).toBe("ring");
  });
});
```

---

## Migration Workflow

1. **Identify command group** (5 min)
2. **Create command file** (2 min)
3. **Copy code from index.ts** (10 min)
4. **Extract helper functions** (15 min)
5. **Update imports** (5 min)
6. **Register in commands/index.ts** (2 min)
7. **Test** (10 min)
8. **Update index.ts** (5 min)

**Total per command: ~50 minutes**

For 19 commands: ~16 hours (matches Phase 2 estimate)

---

## Common Pitfalls to Avoid

1. **Incomplete imports** - Ensure all utilities are imported
2. **Circular dependencies** - Commands shouldn't import from other commands
3. **Mixed concerns** - Keep parsing, rendering, and logic separate
4. **Global state** - Use system context instead of globals
5. **Long functions** - Extract helper functions if >50 lines
6. **Incomplete error handling** - Wrap in try-catch as needed
7. **Forgotten tests** - Write tests during extraction, not after

---

For more details, see `/docs/REFACTORING_CLI.md`
