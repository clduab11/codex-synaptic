#!/usr/bin/env zsh

# Codex-Synaptic shell bootstrap helper
# Source this from your shell profile (e.g. ~/.zshrc) to automatically prime the
# OpenAI Codex CLI with Codex-Synaptic context whenever a new interactive shell starts.

if [[ -n "${CODEX_SYNAPTIC_PRIME_DISABLE:-}" ]]; then
  return 0
fi

if [[ -n "${__CODEX_SYNAPTIC_PRIME_DONE:-}" ]]; then
  return 0
fi

if ! command -v codex-synaptic >/dev/null 2>&1; then
  return 0
fi

if ! command -v codex >/dev/null 2>&1; then
  return 0
fi

__CODEX_SYNAPTIC_PRIME_DONE=1

CODEX_SYNAPTIC_PRIME_PROMPT_DEFAULT=$'Prime the Codex CLI for Codex-Synaptic orchestration.\n'\
'Summarize current capabilities, active agents, mesh/swarm commands, and highlight how to deploy workers.\n'\
'Wait for further instructions after confirming the orchestration surface is ready.'

codex_synaptic_prime_prompt="${CODEX_SYNAPTIC_PRIME_PROMPT:-$CODEX_SYNAPTIC_PRIME_PROMPT_DEFAULT}"

codex-synaptic --codex "${codex_synaptic_prime_prompt}" >/dev/null 2>&1 || true

