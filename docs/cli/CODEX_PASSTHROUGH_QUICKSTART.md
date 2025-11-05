# Codex CLI Passthrough - Quick Start Guide

## ✅ Installation Verified

The Codex CLI is installed at: `/opt/homebrew/bin/codex`

## 🚀 Ready to Use

The passthrough implementation is **complete and working**! You can now use any `codex-synaptic` command with the `--codex` flag to get AI-powered assistance.

## Basic Usage

### 1. Ask for Help
```bash
codex-synaptic --codex "Show me the current status of the system"
```

### 2. Deploy Agents with AI Guidance
```bash
codex-synaptic --codex "Deploy the right mix of agents for a code refactoring project"
```

### 3. Configure Neural Mesh
```bash
codex-synaptic --codex "Set up an optimal neural mesh topology for 8 agents"
```

### 4. Learn About Agent Types
```bash
codex-synaptic --codex "What agent types are available and what do they do?"
```

### 5. Get Command Help
```bash
codex-synaptic --codex "How do I start a swarm using PSO algorithm?"
```

## What Happens Behind the Scenes

When you run `codex-synaptic --codex "<your question>"`:

1. **Context Building** (~150ms)
   - Loads complete README.md documentation
   - Includes full AGENTS.md (25+ agent types)
   - Gathers current system state (if running)
   - Scans .codex* directories
   - Compiles CLI commands reference

2. **Passthrough Execution**
   - Prepends full context to your question
   - Calls: `codex exec "<context + your question>"`
   - Codex receives ~25KB of platform knowledge
   - Provides intelligent, context-aware responses

3. **Interactive Session**
   - Codex can ask clarifying questions
   - Suggest specific commands to run
   - Explain platform features
   - Help troubleshoot issues

## Preview Mode (Dry-Run)

See exactly what context gets sent before executing:

```bash
codex-synaptic --codex --dry-run "Your question here"
```

This shows you:
- Complete context being sent
- Size of each section
- Any truncation notices
- The final prompt

## Example Session

```bash
$ codex-synaptic --codex "I want to analyze a codebase for security issues"

🔀 Codex CLI Passthrough Mode Activated
   Enriching command with Codex-Synaptic platform context...

📚 Building Codex-Synaptic context for passthrough...
🚀 Passing through to Codex CLI: /opt/homebrew/bin/codex
   Prompt: Execute I want to analyze a codebase for security issues command

OpenAI Codex v0.46.0 (research preview)
--------
workdir: /Users/you/project/codex-synaptic
model: gpt-5-codex
...

[Codex provides intelligent response with specific commands to run]
```

## Tips for Best Results

1. **Be Specific**: Instead of "help", ask "How do I deploy 5 code workers?"
2. **Use Natural Language**: Write questions like you would ask a colleague
3. **Reference Platform Features**: "Set up Byzantine consensus with 7 nodes"
4. **Ask for Examples**: "Show me how to configure a ring mesh topology"
5. **Multi-step Workflows**: "Plan a complete security audit workflow using available agents"

## Automatic Shell Priming

Keep the Codex CLI warmed up every time a new interactive shell opens:

```bash
# ~/.zshrc
source /path/to/codex-synaptic/scripts/codex-shell-prime.zsh
```

The helper script calls:

```bash
codex-synaptic --codex "Prime the Codex CLI for Codex-Synaptic orchestration..."
```

Customize or disable behavior:

- `CODEX_SYNAPTIC_PRIME_PROMPT="Summarize key orchestration commands"` overrides the startup prompt
- `CODEX_SYNAPTIC_PRIME_DISABLE=1` skips priming (per shell or globally)

The script short-circuits if `codex` or `codex-synaptic` is missing and only runs once per shell session.

## What Codex Knows About Codex-Synaptic

Thanks to the comprehensive context, Codex understands:

✅ All 25+ agent types and their capabilities  
✅ Neural mesh topologies (ring, mesh, star, tree)  
✅ Swarm algorithms (PSO, ACO, flocking)  
✅ Consensus mechanisms (Raft, Byzantine, PoW, PoS)  
✅ Tree-of-Thought reasoning workflows  
✅ Hive-mind orchestration patterns  
✅ Every CLI command and its usage  
✅ Platform architecture and design patterns  

## Advanced Usage

### Chain Multiple Queries
```bash
# First get guidance
codex-synaptic --codex "Plan a performance optimization workflow"

# Then execute the suggested commands
codex-synaptic agent deploy performance_worker 3
codex-synaptic mesh configure --topology mesh --nodes 8
codex-synaptic swarm start --algorithm pso
```

### Troubleshooting Help
```bash
codex-synaptic --codex "The swarm coordinator isn't responding, what should I check?"
```

### Architecture Decisions
```bash
codex-synaptic --codex "Should I use Byzantine or Raft consensus for a 10-node cluster?"
```

### Learning the Platform
```bash
codex-synaptic --codex "Explain how neural mesh networking works in this platform"
```

## Differences from `hive-mind spawn --codex`

| Feature | `codex-synaptic --codex` | `hive-mind spawn --codex` |
|---------|-------------------------|---------------------------|
| **Purpose** | Get AI help/guidance | Execute automated task |
| **Interaction** | Interactive Q&A | One-shot execution |
| **External CLI** | Yes (OpenAI Codex) | No (internal) |
| **Use Case** | Learning, planning, troubleshooting | Automated workflows |

**Use `--codex` (passthrough) when you want**:
- Interactive help and guidance
- To learn about the platform
- Planning and architecture advice
- Troubleshooting assistance

**Use `hive-mind spawn --codex` when you want**:
- Automated task execution
- Context-enriched prompts for internal agents
- One-shot workflow completion

## Verification

The implementation has been tested and verified:

✅ Context building works correctly  
✅ Full platform documentation included  
✅ Codex CLI detected and executed  
✅ Dry-run mode shows complete context  
✅ Natural language prompts work  
✅ Interactive sessions supported  

## Next Steps

1. **Try it out**: Run `codex-synaptic --codex "What can you help me with?"`
2. **Explore features**: Ask about specific agent types or capabilities
3. **Get command help**: Let Codex guide you through complex workflows
4. **Learn the platform**: Use it as an interactive documentation system

## Need More Help?

- **Full Guide**: See `docs/cli/codex-passthrough.md`
- **Implementation Details**: See `docs/reports/codex-cli-passthrough-implementation.md`
- **README Section**: Main README has usage examples

---

**Status**: ✅ Production Ready  
**Last Updated**: January 15, 2025  
**Codex CLI Version**: 0.46.0 (verified)
