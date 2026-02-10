#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { basename } from 'node:path';

const EXPECTED_REPO_NAME = 'codex-synaptic';
const EXPECTED_ORIGIN_FRAGMENT = 'github.com/clduab11/codex-synaptic';
const EPHEMERAL_PATHS = new Set([
  '.codex-synaptic/instructions.db',
  '.codex-synaptic/memory.db'
]);

let failures = 0;
let warnings = 0;

function run(command) {
  return execSync(command, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function pass(message) {
  console.log(`PASS  ${message}`);
}

function warn(message) {
  warnings += 1;
  console.log(`WARN  ${message}`);
}

function fail(message) {
  failures += 1;
  console.log(`FAIL  ${message}`);
}

console.log('Codex-Synaptic release preflight');
console.log(`Workspace: ${process.cwd()}`);
console.log('');

const cwdName = basename(process.cwd());
if (cwdName === EXPECTED_REPO_NAME) {
  pass(`directory name is "${EXPECTED_REPO_NAME}"`);
} else {
  fail(`directory name is "${cwdName}" (expected "${EXPECTED_REPO_NAME}")`);
}

try {
  const originUrl = run('git remote get-url origin');
  if (originUrl.includes(EXPECTED_ORIGIN_FRAGMENT)) {
    pass(`origin remote matches ${EXPECTED_ORIGIN_FRAGMENT}`);
  } else {
    fail(`origin remote is "${originUrl}" (expected fragment "${EXPECTED_ORIGIN_FRAGMENT}")`);
  }
} catch (error) {
  fail(`unable to read git origin: ${(error).message}`);
}

try {
  const branch = run('git rev-parse --abbrev-ref HEAD');
  pass(`current branch: ${branch}`);
} catch (error) {
  warn(`unable to read current branch: ${(error).message}`);
}

try {
  const porcelain = run('git status --porcelain');
  const rows = porcelain ? porcelain.split('\n') : [];
  const nonEphemeral = rows
    .map((row) => row.trim())
    .filter(Boolean)
    .filter((row) => {
      const path = row.slice(3).trim();
      return !EPHEMERAL_PATHS.has(path);
    });

  if (!nonEphemeral.length) {
    pass('working tree is clean (ignoring local .codex-synaptic databases)');
  } else {
    fail(`working tree has ${nonEphemeral.length} tracked change(s) outside ephemeral DB files`);
    nonEphemeral.slice(0, 10).forEach((entry) => {
      console.log(`      ${entry}`);
    });
    if (nonEphemeral.length > 10) {
      console.log(`      ... ${nonEphemeral.length - 10} more`);
    }
  }
} catch (error) {
  fail(`unable to inspect git status: ${(error).message}`);
}

try {
  run('npm pack --dry-run');
  pass('npm pack --dry-run completed');
} catch (error) {
  fail(`npm pack --dry-run failed: ${(error).message}`);
}

console.log('');
console.log(`Summary: ${failures} failure(s), ${warnings} warning(s)`);
if (failures > 0) {
  process.exitCode = 1;
}
