# Strategy Manifests

This repository now supports a multi-strategy activation audit pipeline driven by declarative manifests under `config/strategies/`. Each strategy uses a distinct reasoning formalism but shares the same readiness signals collected from the Codex-Synaptic runtime.

## Readiness Evaluations

The strategy engine exposes the following evaluation identifiers. They can be referenced from any manifest and are computed once per execution:

- `systemHealth` – Verifies agent registry stability and scheduler uptime.
- `meshHealth` – Confirms neural mesh node count, connectivity, and dynamic updates.
- `consensusHealth` – Checks the live consensus mechanism against the requested guardrail and ensures no proposals are pending.
- `swarmReadiness` – Ensures the swarm coordinator is optimizing with an adequate particle set.
- `goapCoverage` – Inspects GOAP manifests under `config/goap/` and reports coverage.
- `autoscalerBalance` – Evaluates CPU/memory utilisation and autoscaler thresholds.

Each evaluation emits a stage result with a summary, optional detail payload, and status (`passed`, `warning`, or `failed`).

## Strategy Catalogue

| Strategy        | Manifest Location                                   | Notes |
|-----------------|------------------------------------------------------|-------|
| Behavior Tree   | `config/strategies/behavior/activation-audit.yaml`   | Sequence/selector nodes referencing readiness evaluations. |
| Finite State Machine | `config/strategies/fsm/activation-audit.yaml` | Deterministic transition graph with boolean guard expressions. |
| STRIPS Planner  | `config/strategies/strips/activation-audit.yaml`     | Forward-search operators with boolean preconditions/effects. |
| SHOP (HTN)      | `config/strategies/shop/activation-audit.yaml`       | Hierarchical decomposition; operators link directly to readiness checks. |
| Markov Decision Process | `config/strategies/mdp/activation-audit.yaml` | Value iteration to surface optimal activation actions. |
| Q-learning      | `config/strategies/q-learning/activation-audit.yaml` | Simulated episodes producing learned Q-values and policy. |

### Behavior Tree

```yaml
tree:
  root: activation_sequence
  nodes:
    activation_sequence:
      type: sequence
      children:
        - system_health_node
        - mesh_health_node
        - consensus_gate_node
        - swarm_activation_node
```

Node types:

- `sequence` – All children must succeed (depth-first).
- `selector` – First successful child short-circuits the parent.
- `parallel` – Executes children concurrently; `threshold` controls required successes.
- `task` – Terminal node referencing an evaluation (e.g., `systemHealth`).

### FSM

FSM manifests declare `states`, each with `onEnter` evaluations and optional transitions. Conditions are boolean expressions referencing evaluation identifiers (`systemHealth`, `!meshHealth`, etc.). `terminal` lists accepting states.

### STRIPS & SHOP

- **STRIPS** operators require `preconditions` (boolean facts) and specify `effects`. The planner performs a bounded breadth-first search.
- **SHOP** describes hierarchical tasks and concrete operators. Operators succeed when their preconditions match the current fact set.

### Stochastic Strategies

- **MDP** manifests define states, rewards, and transition probabilities. Value iteration (discount factor configurable) yields an optimal policy.
- **Q-learning** manifests simulate episodes with α/γ/ε parameters. Each transition lists potential outcomes with associated rewards/probabilities.

## Adding New Manifests

1. Create a YAML file within the appropriate `config/strategies/<strategy>/` directory.
2. Populate `metadata.id` (used by `--strategy-profile`). Additional metadata fields (`name`, `description`, `version`) are optional but recommended.
3. Reference evaluations using the identifiers listed above.
4. Run `codex-synaptic hive-mind spawn ... --strategy <strategy> --strategy-profile <id>` to exercise the manifest.

Strategic manifests are validated at runtime; missing nodes or invalid conditions will surface as rich diagnostics in the CLI stream.
