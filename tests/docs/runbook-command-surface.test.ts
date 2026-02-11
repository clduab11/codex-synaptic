import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const runbookPath = join(process.cwd(), 'docs', 'runbooks', 'autoscaler-daemon-coordination.md');

describe('autoscaler daemon coordination runbook command surface', () => {
  it('does not reference unsupported legacy CLI commands', () => {
    const runbook = readFileSync(runbookPath, 'utf8');

    const unsupportedCommands = [
      'codex-synaptic background logs',
      'codex-synaptic background restart',
      'codex-synaptic config show scaling',
      'codex-synaptic agents list --idle',
      'codex-synaptic agents retire',
      'codex-synaptic agents deploy',
      'codex-synaptic system scale-down --force',
      'codex-synaptic system status --verbose',
      'codex-synaptic system status --watch'
    ];

    for (const command of unsupportedCommands) {
      expect(runbook).not.toContain(command);
    }
  });

  it('documents supported equivalents', () => {
    const runbook = readFileSync(runbookPath, 'utf8');

    expect(runbook).toContain('codex-synaptic background status');
    expect(runbook).toContain('codex-synaptic background start');
    expect(runbook).toContain('codex-synaptic background stop');
    expect(runbook).toContain('codex-synaptic agent list');
    expect(runbook).toContain('codex-synaptic agent deploy --type');
    expect(runbook).toContain('codex-synaptic memory list autoscaler_events --limit');
  });
});
