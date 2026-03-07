# Sandbox and rules

## Default mode

Use workspace-write by default:

```bash
codex --sandbox workspace-write --ask-for-approval on-request
```

## Safe command set

Safe under workspace-write for this repo:
- `codex-synaptic launch --strict --json`
- `codex-synaptic project attach <path>`
- `codex-synaptic background status|start|attach|logs|stop`
- `npm install`
- `npm run build`
- `npm run test`
- `npm exec tsc -- --noEmit`

## Commands that need extra allowlist

Mark as unsafe (`safeUnderSandbox=false`) and request minimal allowlist:
- `brew install ...`
- `npm install -g ...`
- Docker auth operations (`codex-synaptic env docker-login ...`)
- Any command requiring writes outside workspace scope

## Minimal approval guidance

When a command is unsafe, specify:
1. exact command
2. reason it needs elevated scope
3. smallest file/path/network allowance needed

Never require blanket full-access defaults.
