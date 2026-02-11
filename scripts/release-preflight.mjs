#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXPECTED_REPO_NAME = 'codex-synaptic';
const EXPECTED_ORIGIN_FRAGMENT = 'github.com/clduab11/codex-synaptic';
const EPHEMERAL_ALLOWLIST_ENV = 'CODEX_RELEASE_PREFLIGHT_EPHEMERAL_ALLOWLIST';
const PREFLIGHT_CONFIG_PATH_ENV = 'CODEX_RELEASE_PREFLIGHT_CONFIG';
export const EPHEMERAL_PATHS = new Set([
  '.codex-synaptic/instructions.db',
  '.codex-synaptic/memory.db'
]);

function normalizeAllowlistPath(path) {
  if (typeof path !== 'string') {
    return '';
  }

  const trimmed = path.trim();
  if (!trimmed) {
    return '';
  }

  let normalized = trimmed.replace(/^"+|"+$/g, '').replace(/\\/g, '/');
  normalized = normalized.replace(/^\.\/+/, '');
  return normalized;
}

export function parseEphemeralAllowlistEnv(raw) {
  if (!raw || typeof raw !== 'string') {
    return [];
  }

  return raw
    .split(/[,\n;]/)
    .map((entry) => normalizeAllowlistPath(entry))
    .filter(Boolean);
}

export function resolvePreflightConfigPath(rawPath = process.env[PREFLIGHT_CONFIG_PATH_ENV]) {
  const normalized = normalizeAllowlistPath(rawPath ?? '');
  if (!normalized) {
    return resolvePath(process.cwd(), 'config', 'system.json');
  }
  return isAbsolute(normalized) ? normalized : resolvePath(process.cwd(), normalized);
}

export function parseEphemeralAllowlistFromConfig(configPath = resolvePreflightConfigPath()) {
  if (!configPath || !existsSync(configPath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    const allowlist = parsed?.releasePreflight?.ephemeralAllowlist;
    if (!Array.isArray(allowlist)) {
      return [];
    }

    return allowlist
      .map((entry) => normalizeAllowlistPath(entry))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function resolveEphemeralPaths(options = {}) {
  const {
    basePaths = EPHEMERAL_PATHS,
    envAllowlist = process.env[EPHEMERAL_ALLOWLIST_ENV],
    configPath,
    configAllowlist
  } = options;

  const resolved = new Set(
    Array.from(basePaths)
      .map((entry) => normalizeAllowlistPath(entry))
      .filter(Boolean)
  );

  const fromConfig = Array.isArray(configAllowlist)
    ? configAllowlist.map((entry) => normalizeAllowlistPath(entry)).filter(Boolean)
    : parseEphemeralAllowlistFromConfig(configPath ?? resolvePreflightConfigPath());

  fromConfig.forEach((entry) => {
    resolved.add(entry);
  });

  parseEphemeralAllowlistEnv(envAllowlist).forEach((entry) => {
    resolved.add(entry);
  });

  return resolved;
}

function run(command) {
  return execSync(command, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

export function extractStatusPathFromPorcelain(row) {
  if (!row) {
    return '';
  }

  const normalized = row.replace(/\r$/, '');
  if (!normalized.trim()) {
    return '';
  }

  let rawPath = '';
  if (normalized.length >= 4 && normalized[2] === ' ') {
    rawPath = normalized.slice(3).trim();
  } else {
    const leftTrimmed = normalized.trimStart();
    if (leftTrimmed.length >= 4 && leftTrimmed[2] === ' ') {
      rawPath = leftTrimmed.slice(3).trim();
    } else {
      const firstSpace = leftTrimmed.indexOf(' ');
      rawPath = firstSpace === -1 ? '' : leftTrimmed.slice(firstSpace + 1).trim();
    }
  }

  if (!rawPath) {
    return '';
  }

  if (rawPath.includes(' -> ')) {
    rawPath = rawPath.split(' -> ').pop()?.trim() ?? rawPath;
  }

  if (rawPath.startsWith('"') && rawPath.endsWith('"') && rawPath.length >= 2) {
    rawPath = rawPath.slice(1, -1);
  }

  return rawPath;
}

export function filterNonEphemeralPorcelainRows(rows, ephemeralPaths = EPHEMERAL_PATHS) {
  return rows
    .filter((row) => typeof row === 'string' && Boolean(row.trim()))
    .filter((row) => {
      const path = extractStatusPathFromPorcelain(row);
      return path ? !ephemeralPaths.has(path) : true;
    });
}

function pass(message) {
  console.log(`PASS  ${message}`);
}

let warnings = 0;
function warn(message) {
  warnings += 1;
  console.log(`WARN  ${message}`);
}

let failures = 0;
function fail(message) {
  failures += 1;
  console.log(`FAIL  ${message}`);
}

export function runReleasePreflight() {
  failures = 0;
  warnings = 0;
  const ephemeralPaths = resolveEphemeralPaths();

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
    fail(`unable to read git origin: ${error.message}`);
  }

  try {
    const branch = run('git rev-parse --abbrev-ref HEAD');
    pass(`current branch: ${branch}`);
  } catch (error) {
    warn(`unable to read current branch: ${error.message}`);
  }

  try {
    const porcelain = run('git status --porcelain');
    const rows = porcelain ? porcelain.split('\n') : [];
    const nonEphemeral = filterNonEphemeralPorcelainRows(rows, ephemeralPaths).map((row) => row.trim());

    if (!nonEphemeral.length) {
      pass('working tree is clean (ignoring ephemeral runtime artifacts)');
    } else {
      fail(`working tree has ${nonEphemeral.length} tracked change(s) outside ephemeral allowlist`);
      nonEphemeral.slice(0, 10).forEach((entry) => {
        console.log(`      ${entry}`);
      });
      if (nonEphemeral.length > 10) {
        console.log(`      ... ${nonEphemeral.length - 10} more`);
      }
    }
  } catch (error) {
    fail(`unable to inspect git status: ${error.message}`);
  }

  try {
    run('npm pack --dry-run');
    pass('npm pack --dry-run completed');
  } catch (error) {
    fail(`npm pack --dry-run failed: ${error.message}`);
  }

  console.log('');
  console.log(`Summary: ${failures} failure(s), ${warnings} warning(s)`);
  if (failures > 0) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runReleasePreflight();
}
