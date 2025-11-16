# CLAUDE.md - Repository Constitution for AI Agents

**Version**: 1.0.0
**Last Updated**: 2025-11-16
**Owner**: Parallax Analytics

---

## 🎯 Purpose

This document serves as the **constitutional guide** for AI agents (Claude, GPT, and others) working on the codex-synaptic repository. It defines principles, constraints, and patterns that ensure consistent, high-quality contributions aligned with the project's architectural vision.

---

## 📐 Architectural Principles

### 1. **Distributed Intelligence First**
- All design decisions should favor distributed coordination over centralized control
- Agents should operate autonomously while respecting consensus boundaries
- Neural mesh topology is sacred—optimize for self-healing and load distribution

### 2. **Complexity Budget**
- **Cyclomatic complexity target**: ≤15 per function (exception: validation/configuration functions)
- **File size limit**: ≤500 lines per module (exception: core system.ts during refactor)
- **Dependency depth**: ≤4 levels to prevent tight coupling
- When complexity is justified (e.g., STRIPS planning, FSM traversal), document rationale

### 3. **Testing is Non-Negotiable**
- **Coverage target**: 75% statement coverage, 65% branch coverage
- Every refactor must include corresponding tests
- Critical paths (consensus, mesh, swarm) require integration tests
- No code without tests for new features or refactors

### 4. **Backward Compatibility by Default**
- Breaking changes require explicit justification and migration guide
- Use deprecation warnings before removal (1-2 release cycles)
- Export compatibility shims when extracting modules

---

## 🔧 Development Patterns

### Module Organization
```
src/
├── core/          # Orchestration, system, config, types
├── agents/        # 25+ specialized agent implementations
├── cli/           # Command-line interface and utilities
├── consensus/     # RAFT, BFT, voting mechanisms
├── mesh/          # Neural mesh topology management
├── swarm/         # PSO, ACO, flocking algorithms
├── memory/        # SQLite persistence, namespaces
├── reasoning/     # ToT, ReAct, GOAP, strategies
├── tenancy/       # Multi-tenant isolation and quotas
├── openai/        # OpenAI Responses API integration
└── tools/         # Tool optimizer, intent scoring
```

### Naming Conventions
- **Files**: kebab-case (`agent-composition-strategy.ts`)
- **Classes**: PascalCase (`HeuristicCompositionStrategy`)
- **Functions**: camelCase (`analyzePromptForAgents`)
- **Constants**: UPPER_SNAKE_CASE (`SUPPORTED_STRATEGIES`)
- **Interfaces**: PascalCase with descriptive names (`AgentCompositionStrategy`)

### Error Handling
- Use `CodexSynapticError` and subclasses for domain errors
- Wrap external errors with context (e.g., "Failed to deploy agent: {reason}")
- Log errors with structured metadata (agentId, taskId, timestamp)
- Never swallow errors silently—always log or propagate

### Logging Conventions
- **Levels**: error, warn, info, debug
- **Format**: `logger.info('component', 'message', { context }, optionalError)`
- **Components**: 'system', 'consensus', 'mesh', 'swarm', 'agent', 'cli', 'strategy'
- Include correlation IDs (taskId, agentId, proposalId) in metadata

---

## 🚫 Forbidden Patterns

### **DO NOT**:
1. **Modify consensus voting without quorum analysis** — Breaking RAFT quorum causes timeouts
2. **Add dependencies without justification** — Keep dependency footprint minimal
3. **Bypass autoscaler during daemon offline** — Document coordination requirements
4. **Hardcode paths or credentials** — Use env vars and config/system.json
5. **Skip migration scripts for schema changes** — Memory and config schema changes need migrations
6. **Introduce global state** — Use dependency injection and explicit passing
7. **Create God objects** — Favor composition over monolithic classes

---

## 📝 Refactoring Guidelines

### When to Refactor
- Cyclomatic complexity >15 (except justified cases)
- Function length >80 lines
- Duplicate code appears 3+ times
- Module coupling prevents testing

### How to Refactor
1. **Read existing tests** — Understand behavior before changing
2. **Extract incrementally** — Small, focused changes (1-3 functions per commit)
3. **Add tests first** — Red-Green-Refactor cycle
4. **Document rationale** — Explain complexity reduction in commit message
5. **Maintain compatibility** — Re-export for backward compatibility
6. **Verify builds** — Ensure TypeScript compiles without new errors

### Refactor Checklist
- [ ] Tests added/updated for extracted code
- [ ] Cyclomatic complexity reduced (document before/after)
- [ ] Backward compatibility maintained (or migration guide provided)
- [ ] Documentation updated (README, AGENTS.md, runbooks)
- [ ] Commit message explains rationale and impact
- [ ] Build passes (`npm run build && npm test`)

---

## 🔐 Security Constraints

### Input Validation
- Sanitize all CLI inputs (paths, JSON, YAML)
- Validate agent task payloads before execution
- Enforce resource quotas (CPU, memory, iterations)
- Reject oversized prompts (>4096 chars without explicit flag)

### Consensus Security
- All consensus proposals require proposer identity
- Votes must include voter agent ID for audit trails
- Timeout proposals after configured period (default: 10s)
- Log all consensus decisions to `consensus_events` namespace

### Multi-Tenancy
- Enforce tenant isolation in memory namespaces
- Validate tenant IDs against allow-list (when enabled)
- Apply quotas before task execution
- Audit cross-tenant access attempts

---

## 📚 Documentation Standards

### Code Comments
- **Functions**: JSDoc with `@param`, `@returns`, `@throws`
- **Complex logic**: Inline comments explaining "why", not "what"
- **TODOs**: Include ticket reference and assignee (`TODO(#123): add retry logic`)
- **Deprecations**: Mark with `@deprecated` and removal timeline

### Runbook Requirements
- **Title**: Clear problem statement
- **Symptoms**: Observable behavior
- **Diagnosis**: Commands to verify issue
- **Resolution**: Step-by-step fix with examples
- **Related Docs**: Links to architecture docs and code

### Commit Messages
```
type(scope): brief summary (≤72 chars)

Longer explanation of what changed and why. Reference issue/PR numbers.
Include before/after metrics for refactors (e.g., complexity 19 → 2).

Breaking changes should be called out explicitly.

Related: Issue #34, PR #35
```

**Types**: feat, fix, refactor, docs, test, chore, perf, ci

---

## 🧪 Testing Strategy

### Unit Tests (Vitest)
- Test pure functions in isolation
- Mock external dependencies (system, agents, network)
- Cover happy paths and error branches
- Target: 80%+ coverage for new code

### Integration Tests
- Test module interactions (agent → scheduler → registry)
- Use ephemeral SQLite databases for memory tests
- Verify event emission and handling
- Test consensus workflows end-to-end

### Scenario Tests
- Complex workflows (hive-mind spawn, strategy execution)
- Edge cases (mesh reconfiguration, quorum variance)
- Failure modes (daemon offline, agent crash, timeout)
- Performance regression baselines

---

## 🎨 Style Guide

### TypeScript
- **Strict mode**: Enabled (`strict: true` in tsconfig.json)
- **No `any`**: Use `unknown` or specific types
- **Prefer interfaces** for public contracts, types for unions/aliases
- **Async/await** over raw Promises
- **Optional chaining** (`?.`) for safe navigation

### Code Formatting
- **Prettier** for auto-formatting (run `npm run format`)
- **ESLint** for linting (run `npm run lint`)
- **Line length**: 120 characters max
- **Indentation**: 2 spaces

---

## 🛠️ CI/CD Integration

### Pre-Commit Checks
- [ ] `npm run lint` passes
- [ ] `npm run build` succeeds
- [ ] `npm test` passes (all tests)
- [ ] No new TypeScript errors

### PR Requirements
- [ ] Description references issue (e.g., "Closes #34")
- [ ] Includes before/after metrics for refactors
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] Changelog entry added (for user-facing changes)

---

## 🗂️ Memory & Persistence

### Namespaces
- `tot_runs` — Tree-of-Thought planning runs
- `tool_usage` — Tool optimizer telemetry
- `autoscaler_events` — Scale-up/down events
- `mesh_events` — Topology changes
- `consensus_events` — Proposal and vote records
- `goap_runs` — GOAP execution traces
- `strategy_runs` — Reasoning strategy results

### Retention Policy
- **Default TTL**: 30 days
- **Critical events** (consensus, failures): Indefinite
- **Telemetry** (tool usage, autoscaler): 7 days
- Manual cleanup: `codex-synaptic memory clean --namespace <name> --older-than 30d`

---

## 🔗 Integration Points

### OpenAI Responses API
- Use `OpenAIResponsesClient` for all LLM calls
- Respect rate limits (track via `OpenAIUsageMonitor`)
- Log token usage to telemetry
- Fallback to configured models (per `modelCatalog`)

### MCP Bridge
- Use `MCPBridge` for Model Context Protocol integrations
- Validate incoming requests (schema, auth)
- Emit events for observability

### External Tools
- Register tools with `ToolOptimizer`
- Track success rates and latency
- Recommend tools based on intent matching

---

## 📖 Quick Reference

### Common Commands
```bash
# Build and test
npm run build
npm test

# Lint and format
npm run lint
npm run format

# CLI operations
codex-synaptic system status
codex-synaptic hive-mind spawn --prompt "analyze codebase"
codex-synaptic consensus propose "decision" --mechanism raft

# Background daemon
codex-synaptic background start
codex-synaptic background status
codex-synaptic background stop
```

### Key Files
- `src/core/system.ts` — Main orchestrator
- `src/core/config.ts` — Configuration validation
- `src/consensus/manager.ts` — RAFT consensus
- `src/cli/index.ts` — CLI entrypoint
- `docs/beta-readiness-checklist.md` — Release criteria
- `AGENTS.md` — Agent architecture and playbook

---

## 🚀 Contributing as an AI Agent

When you (Claude, GPT, or another AI) contribute to this repository:

1. **Read this document first** — It's your north star
2. **Check beta-readiness-checklist.md** — Understand current priorities
3. **Review AGENTS.md** — Understand agent orchestration patterns
4. **Scan recent commits** — Learn from recent changes
5. **Follow refactoring checklist** — Ensure quality and compatibility
6. **Ask for clarification** — When constraints conflict, ask the user
7. **Document your changes** — Future agents (and humans) will thank you

---

## 🎓 Learning Resources

- **Architecture**: `docs/architecture.md`
- **CLI Commands**: `docs/cli/` directory
- **Observability**: `docs/observability/README.md`
- **Runbooks**: `docs/runbooks/`
- **Strategy Manifests**: `docs/reasoning/strategy-manifests.md`

---

**Remember**: This is a living document. As the project evolves, update this constitution to reflect new patterns, constraints, and lessons learned. The goal is to make every AI agent session smarter and safer than the last.

---

**Last Reviewed**: 2025-11-16
**Next Review**: After Stage 2 refactoring (Decompose Core)
