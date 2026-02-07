# Codex for macOS Enhancer Refactor

This directory captures the refactor plan to evolve **codex-synaptic** into a modular, language-agnostic enhancer layer for **Codex for macOS**. It focuses on bounded contexts, integration surfaces, and a migration path that preserves current behavior while enabling swarm augmentation.

## Navigation

- [Vision](./VISION.md)
- [Milestones](./MILESTONES.md)
- [Architecture](./architecture/bounded-contexts.md)
- [Integration Patterns](./architecture/integration-patterns.md)
- [Language-Agnostic Design](./architecture/language-agnostic-design.md)
- [Research Spikes](./research/)
- [Topology Roadmaps](./topology/)
- [Migration Plans](./migration/)

## Principles

- **Enhancer-first**: codex-synaptic acts as a sidecar/extension, not a replacement for Codex for macOS.
- **Language-agnostic contracts**: gRPC/REST interfaces define boundaries between contexts.
- **Backward compatibility**: changes land behind compatibility layers and clear migration guides.
- **Evidence-driven**: research spikes include links, notes, and actionable outcomes.
