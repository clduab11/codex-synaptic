# Codex CLI Passthrough

## Overview

Similar to `claude-flow`, Codex-Synaptic supports passing commands with the `--codex` flag directly through to the OpenAI Codex CLI, automatically enriching them with comprehensive platform context.

## How It Works

When you add `--codex` to any `codex-synaptic` command (except `hive-mind spawn` and `cheat` which have their own `--codex` behavior), the CLI:

1. **Intercepts the command** before normal processing
2. **Builds comprehensive context** including:
   - Full README.md (platform capabilities)
   - Complete AGENTS.md (all 25+ agent types and architecture)
   - Current system state (active agents, mesh, swarm, consensus)
   - Codex-Synaptic artifacts (.codex* directories, databases)
   - AGENTS.md directives and configuration
   - Available CLI commands reference
3. **Passes through to Codex CLI** with enriched context
4. **Executes with full platform awareness**

## Installation

First, install the OpenAI Codex CLI:

```bash
# npm
npm install -g @openai/codex-cli

# or Homebrew
brew install openai/tap/codex-cli
```

## Usage Examples

### Basic Passthrough

```bash
# Ask Codex to deploy agents using Codex-Synaptic
codex-synaptic --codex "Deploy 5 code workers and configure them in a mesh topology"

# Have Codex analyze your system
codex-synaptic --codex "What's the current status of my neural mesh?"

# Let Codex orchestrate a complex workflow
codex-synaptic --codex "Start a swarm using PSO algorithm with 8 agents to optimize this codebase"
```

### Dry Run (Preview Context)

```bash
# See what context will be sent to Codex without executing
codex-synaptic --codex --dry-run "Deploy agents"
```

This shows you the complete context block that includes:
- Platform capabilities summary
- README.md documentation
- AGENTS.md architecture
- Current system state
- CLI commands reference

### Verbose Mode

```bash
# Show detailed information about context building
codex-synaptic --codex --verbose "Configure mesh topology"
```

## What Gets Sent to Codex

The Codex CLI receives a comprehensive context file containing:

### 1. Platform Capabilities
- Neural mesh networking overview
- Swarm intelligence algorithms
- Consensus mechanisms
- Agent types and specializations
- Tree-of-Thought reasoning
- Multi-tenancy features

### 2. Full Documentation
- **README.md**: Complete platform documentation (first 15k chars)
- **AGENTS.md**: All agent types, architectures, deployment strategies

### 3. Current System State (if running)
```
Agents: 5/10 active
Active Agent Types:
  - code_worker: 3 instance(s)
  - validation_worker: 2 instance(s)
Neural Mesh: 8 nodes, 12 links, mesh topology
Swarm: Active (pso)
Consensus: 2 pending proposals, byzantine mechanism
```

### 4. Artifacts & Directives
- All AGENTS.md directive files
- .codex* directory inventories
- Database metadata (*.db, *.sqlite*)
- Repository-specific instructions

### 5. CLI Commands Reference
Complete list of available commands with descriptions:
- System management
- Agent operations
- Neural mesh controls
- Swarm coordination
- Hive-mind workflows
- Consensus mechanisms
- And more...

### 6. Usage Guidance
Instructions on how Codex should interact with the platform, including:
- How to deploy agents
- How to configure mesh topologies
- How to start swarms
- How to propose consensus
- How to use Tree-of-Thought planning

## Examples of What Codex Can Do

With full platform context, Codex can:

### 1. Orchestrate Complex Workflows
```bash
codex-synaptic --codex "Analyze this codebase for performance issues, deploy performance workers, configure them in a star topology, and run a PSO optimization swarm"
```

### 2. Self-Diagnose and Improve
```bash
codex-synaptic --codex "Check system health, identify any bottlenecks, and propose improvements"
```

### 3. Intelligent Agent Deployment
```bash
codex-synaptic --codex "Based on the current project structure, deploy appropriate specialized workers"
```

### 4. Multi-Agent Coordination
```bash
codex-synaptic --codex "Set up a Byzantine consensus network with 7 nodes and run a code review workflow"
```

### 5. Tree-of-Thought Planning
```bash
codex-synaptic --codex "Create a comprehensive ToT plan for refactoring the authentication system, including all necessary agent types and consensus gates"
```

## Comparison with `hive-mind spawn --codex`

There are two different `--codex` behaviors:

| Command | Behavior |
|---------|----------|
| `codex-synaptic --codex "task"` | **Passthrough**: Sends to external Codex CLI with platform context |
| `codex-synaptic hive-mind spawn --codex "task"` | **Internal**: Enriches prompt for internal hive-mind orchestration |

Use passthrough (`--codex` before command) when you want Codex to:
- Interactively help you use Codex-Synaptic
- Make decisions about which commands to run
- Understand the platform architecture
- Guide you through complex workflows

Use `hive-mind spawn --codex` when you want to:
- Execute a specific task with context
- Run automated workflows
- Let the internal swarm handle the work

## Technical Details

### Context File
A temporary file `.codex-synaptic-context.tmp` is created with the full context and passed to Codex CLI via `--context-file` flag. The file is automatically cleaned up after execution.

### Environment
The `CODEX_SYNAPTIC_CONTEXT=1` environment variable is set when calling Codex CLI, allowing the Codex CLI to detect it's being called from Codex-Synaptic.

### System State Detection
If the Codex-Synaptic orchestrator is running (via `background start` or `system start`), the current state is included. Otherwise, a note is added that the system should be started first.

## Troubleshooting

### Codex CLI Not Found
```bash
# Check if Codex CLI is installed
which codex
# or
codex --version

# If not installed:
npm install -g @openai/codex-cli
```

### Context Too Large
If you hit context limits, the builder automatically:
- Truncates README.md to 15k characters
- Truncates AGENTS.md directives to safe limits
- Prioritizes critical information

You can also use `--dry-run` to inspect the context size before sending.

### Authentication Issues
Ensure your Codex CLI is authenticated:
```bash
codex auth login
```

## Best Practices

1. **Start with `--dry-run`** to preview context
2. **Use verbose mode** (`--verbose`) to understand what's happening
3. **Keep orchestrator running** for accurate system state
4. **Combine with interactive mode** for guided workflows:
   ```bash
   codex-synaptic interactive
   # Then use embedded CLI runner with --codex
   ```

## Security Considerations

The passthrough includes:
- ✅ Public documentation (README, AGENTS.md)
- ✅ System configuration
- ✅ Agent status and capabilities
- ✅ Mesh/swarm/consensus state
- ❌ **No secrets or credentials**
- ❌ **No source code** (unless in .codex* directories)
- ❌ **No sensitive data**

Always review with `--dry-run` before sending to external services.

## Future Enhancements

Planned improvements:
- [ ] Context caching for faster execution
- [ ] Selective context inclusion (flags to include/exclude sections)
- [ ] Response parsing and automatic command execution
- [ ] Session persistence across multiple Codex calls
- [ ] Integration with GitHub Copilot Chat
- [ ] Custom context templates
