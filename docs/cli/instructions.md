# Codex-Synaptic Instruction CLI

The `codex-synaptic instructions` command group keeps AGENTS.md directives discoverable, validated, and cached so the swarm can attach the right context to every run. Use these subcommands whenever you add or restructure instruction files.

## Sync

Pull every `AGENTS.md` into the SQLite-backed cache with precedence ordering (global → project → local → override). This is the command you should run after modifying instructions or cloning a fresh workspace.

```bash
codex-synaptic instructions sync
# Options:
#   --root <path>     Repository root to scan (defaults to current working dir)
#   --no-cache        Force re-parse without reading the cache
#   --verbose         Print precedence chain, hash, and timing metrics
```

## Validate

Lint one file or the whole tree for empty content, malformed headers, and unclosed code blocks. Failed validations are surfaced with line-level messages.

```bash
# Validate every discovered instruction file
codex-synaptic instructions validate

# Validate a specific file
codex-synaptic instructions validate path/to/AGENTS.md
```

## Cache Management

Inspect or clear the instruction cache without touching other telemetry state.

```bash
# Show cache entries (counts, sizes, TTLs)
codex-synaptic instructions cache --status

# Limit operations to a specific repository root
codex-synaptic instructions cache --status --root /path/to/repo

# Clear cache for every root
codex-synaptic instructions cache --clear

# Clear cache for a single root
codex-synaptic instructions cache --clear /path/to/repo
```

The status view reports:

- Total entries and unique roots stored
- Human-readable byte size per cached context
- Creation and expiry timestamps (highlighting expired entries)
- Truncated context hashes for quick comparisons

## Quick Workflow

1. `codex-synaptic instructions sync --verbose` after you edit any AGENTS.md file.
2. `codex-synaptic instructions validate` to double-check formatting before committing.
3. `codex-synaptic instructions cache --status --root .` to confirm the cache is warm.

Keeping this loop tight ensures Sprint 1’s instruction graph plumbing stays healthy and that downstream routing decisions always see the latest directives.
