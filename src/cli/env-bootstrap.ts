import { existsSync, readFileSync } from "fs";
import { relative, resolve } from "path";

function parseBooleanFlag(
  value: string | undefined,
  fallback: boolean,
): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

export function shouldAutoLoadCliEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return parseBooleanFlag(env.CODEX_CLI_ENV_AUTOLOAD, true);
}

export function shouldShowCliEnvBanner(
  options: {
    env?: NodeJS.ProcessEnv;
    cliSilent?: boolean;
    argv?: string[];
  } = {},
): boolean {
  const env = options.env ?? process.env;
  const cliSilent = options.cliSilent === true;
  const argv = options.argv ?? process.argv;

  if (cliSilent) {
    return false;
  }

  // Keep JSON stdout clean by default; allow override for debugging.
  if (
    argv.includes("--json") &&
    !parseBooleanFlag(env.CODEX_CLI_ENV_BANNER_FORCE, false)
  ) {
    return false;
  }

  return parseBooleanFlag(env.CODEX_CLI_ENV_BANNER, true);
}

export function loadEnvFile(
  filePath: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!existsSync(filePath)) {
    return false;
  }

  try {
    const content = readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    let applied = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }

      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      if (!key) {
        continue;
      }

      let value = line.slice(separatorIndex + 1).trim();
      if (!value) {
        value = "";
      }

      const startsWithQuote = value.startsWith('"') || value.startsWith("'");
      const endsWithQuote = value.endsWith('"') || value.endsWith("'");
      if (startsWithQuote && endsWithQuote && value.length >= 2) {
        value = value.slice(1, -1);
      }

      value = value
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t");

      if (env[key] === undefined) {
        env[key] = value;
        applied = true;
      }
    }

    return applied;
  } catch {
    return false;
  }
}

export function bootstrapCliEnv(
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): string[] {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const sources: string[] = [];

  const candidates = [
    resolve(cwd, ".env"),
    resolve(cwd, ".env.local"),
    resolve(cwd, "src/cli/.env"),
  ];

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    if (loadEnvFile(candidate, env)) {
      sources.push(candidate);
    }
  }

  return sources;
}

export function buildCliEnvBootstrapMessages(
  loadedSources: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): string[] {
  if (!loadedSources.length) {
    return [];
  }

  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const verbosePaths =
    parseBooleanFlag(env.CODEX_CLI_ENV_BANNER_VERBOSE, false) ||
    env.CODEX_DEBUG === "1";
  const loadedSrcCliEnv = loadedSources.some((source) =>
    /(^|[\\/])src[\\/]cli[\\/]\.env$/.test(source),
  );

  const firstLine = verbosePaths
    ? `⚙️  Environment variables loaded from ${loadedSources
        .map((source) => relative(cwd, source) || source)
        .join(", ")}`
    : `⚙️  Environment variables loaded from local .env file(s) (${loadedSources.length}).`;

  const lines = [firstLine];

  if (loadedSrcCliEnv) {
    lines.push(
      "🔒 `src/cli/.env` is local-sensitive state. Avoid sharing logs/screenshots with local env details; set CODEX_CLI_ENV_AUTOLOAD=0 to disable auto-loading.",
    );
  }

  return lines;
}
