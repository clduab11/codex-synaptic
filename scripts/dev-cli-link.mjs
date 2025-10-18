#!/usr/bin/env node

/**
 * Dev convenience shim: ensure the global `codex-synaptic` command points to this checkout.
 * This keeps feature flags like `--codex` in sync when working from source.
 */

import { spawnSync } from 'node:child_process';

const DISABLE = process.env.CODEX_AUTO_LINK?.toLowerCase();
if (DISABLE === '0' || DISABLE === 'false') {
  process.exit(0);
}

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    stdio: 'pipe',
    encoding: 'utf8',
    ...opts
  });
  return result;
}

function commandIncludesCodex() {
  const help = run('codex-synaptic', ['hive-mind', 'spawn', '--help']);
  if (help.status !== 0) {
    return false;
  }
  return help.stdout.includes('--codex');
}

function linkCli() {
  const result = run('npm', ['link'], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.warn('[codex-synaptic] Unable to link CLI automatically. Run `npm link` manually to refresh the shim.');
  }
}

function commandExists() {
  const probe = run(process.platform === 'win32' ? 'where' : 'which', ['codex-synaptic']);
  if (probe.error) {
    return false;
  }
  return probe.status === 0;
}

if (!commandExists()) {
  linkCli();
  process.exit(0);
}

if (!commandIncludesCodex()) {
  linkCli();
}
