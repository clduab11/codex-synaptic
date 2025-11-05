import { LogLevel } from '../../core/logger.js';

export interface EnvBootstrapSummary {
  autoSet: string[];
  warnings: string[];
  notes: string[];
}

const CONSENSUS_ALIASES: Record<string, 'raft' | 'bft' | 'pow' | 'pos' | 'hybrid'> = {
  raft: 'raft',
  bft: 'bft',
  byzantine: 'bft',
  pow: 'pow',
  'proof-of-work': 'pow',
  pos: 'pos',
  'proof-of-stake': 'pos',
  hybrid: 'hybrid'
};

const LOG_LEVEL_ALIASES: Record<string, LogLevel> = {
  debug: LogLevel.DEBUG,
  verbose: LogLevel.DEBUG,
  info: LogLevel.INFO,
  notice: LogLevel.INFO,
  warn: LogLevel.WARN,
  warning: LogLevel.WARN,
  error: LogLevel.ERROR,
  fatal: LogLevel.FATAL,
  critical: LogLevel.FATAL
};

export function ensureSystemBootstrapEnv(): EnvBootstrapSummary {
  const summary: EnvBootstrapSummary = {
    autoSet: [],
    warnings: [],
    notes: []
  };

  if (!process.env.CODEX_ADMIN_PASSWORD || process.env.CODEX_ADMIN_PASSWORD.length === 0) {
    const fallbackPassword = process.env.CODEX_DEFAULT_ADMIN_PASSWORD ?? 'adminpass';
    process.env.CODEX_ADMIN_PASSWORD = fallbackPassword;
    summary.autoSet.push('CODEX_ADMIN_PASSWORD');
    summary.notes.push('CODEX_ADMIN_PASSWORD defaulted to "adminpass" for local sessions. Override for production.');
  }

  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.length === 0) {
    const fallbackKey = process.env.CODEX_OPENAI_API_KEY ?? process.env.OPENAI_DEV_API_KEY;
    if (fallbackKey && fallbackKey.length > 0) {
      process.env.OPENAI_API_KEY = fallbackKey;
      summary.autoSet.push('OPENAI_API_KEY');
      summary.notes.push('OPENAI_API_KEY sourced from fallback environment variable.');
    } else {
      summary.warnings.push('OPENAI_API_KEY is not set. OpenAI responses remain disabled until you export it.');
    }
  }

  return summary;
}

export function normalizeConsensusMechanism(value?: string): 'raft' | 'bft' | 'pow' | 'pos' | 'hybrid' {
  const normalized = (value ?? 'raft').toLowerCase();
  return CONSENSUS_ALIASES[normalized] ?? 'raft';
}

export function parseLogLevelOption(value: string | undefined, fallback: LogLevel = LogLevel.INFO): LogLevel {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  return LOG_LEVEL_ALIASES[normalized] ?? fallback;
}
