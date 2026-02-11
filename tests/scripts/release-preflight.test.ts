import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  EPHEMERAL_PATHS,
  extractStatusPathFromPorcelain,
  filterNonEphemeralPorcelainRows,
  parseEphemeralAllowlistEnv,
  parseEphemeralAllowlistFromConfig,
  resolveEphemeralPaths
} from '../../scripts/release-preflight.mjs';

describe('release-preflight porcelain parsing', () => {
  it('extracts path from leading-space modified rows', () => {
    expect(extractStatusPathFromPorcelain(' M .codex-synaptic/memory.db')).toBe('.codex-synaptic/memory.db');
  });

  it('extracts path from already-trimmed rows', () => {
    expect(extractStatusPathFromPorcelain('M .codex-synaptic/memory.db')).toBe('.codex-synaptic/memory.db');
  });

  it('extracts rename target path from rename rows', () => {
    expect(extractStatusPathFromPorcelain('R  old/path.txt -> .codex-synaptic/memory.db')).toBe(
      '.codex-synaptic/memory.db'
    );
  });

  it('filters ephemeral DB rows while preserving non-ephemeral changes', () => {
    const rows = [
      ' M .codex-synaptic/memory.db',
      ' M README.md',
      'R  old/path.txt -> .codex-synaptic/instructions.db'
    ];

    const nonEphemeral = filterNonEphemeralPorcelainRows(rows, EPHEMERAL_PATHS);
    expect(nonEphemeral).toEqual([' M README.md']);
  });

  it('parses env-based ephemeral allowlist entries', () => {
    const parsed = parseEphemeralAllowlistEnv('.codex-synaptic/runtime.pid, logs/runtime.trace\n./tmp/state.lock');
    expect(parsed).toEqual(['.codex-synaptic/runtime.pid', 'logs/runtime.trace', 'tmp/state.lock']);
  });

  it('reads configurable ephemeral allowlist from config file', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'release-preflight-'));
    const configPath = join(tempRoot, 'system.json');

    writeFileSync(
      configPath,
      JSON.stringify(
        {
          releasePreflight: {
            ephemeralAllowlist: ['.codex-synaptic/runtime.pid', './logs/runtime.trace']
          }
        },
        null,
        2
      ),
      'utf8'
    );

    const fromConfig = parseEphemeralAllowlistFromConfig(configPath);
    expect(fromConfig).toEqual(['.codex-synaptic/runtime.pid', 'logs/runtime.trace']);

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('merges default, config, and env allowlists for ephemeral filtering', () => {
    const ephemeral = resolveEphemeralPaths({
      basePaths: new Set(['.codex-synaptic/memory.db']),
      configAllowlist: ['tmp/runtime.lock'],
      envAllowlist: '.codex-synaptic/runtime.pid'
    });

    const rows = [
      ' M .codex-synaptic/memory.db',
      ' M tmp/runtime.lock',
      ' M .codex-synaptic/runtime.pid',
      ' M README.md'
    ];

    const nonEphemeral = filterNonEphemeralPorcelainRows(rows, ephemeral);
    expect(nonEphemeral).toEqual([' M README.md']);
  });
});
