import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';
import { getDaemonPaths } from './daemon-manager.js';

export interface AttachedProjectRecord {
  path: string;
  attachedAt: string;
  agentsFile: string | null;
  codexConfig: string | null;
  synapticConfig: string | null;
}

interface AttachmentStore {
  projects: AttachedProjectRecord[];
}

function attachmentFilePath(): string {
  return join(getDaemonPaths().stateDir, 'attached-projects.json');
}

function readStore(): AttachmentStore {
  const file = attachmentFilePath();
  if (!existsSync(file)) {
    return { projects: [] };
  }

  try {
    return JSON.parse(readFileSync(file, 'utf8')) as AttachmentStore;
  } catch {
    return { projects: [] };
  }
}

function writeStore(store: AttachmentStore): void {
  const file = attachmentFilePath();
  mkdirSync(getDaemonPaths().stateDir, { recursive: true });
  writeFileSync(file, JSON.stringify(store, null, 2), 'utf8');
}

export function attachProject(targetPath: string): AttachedProjectRecord {
  const absolutePath = resolve(targetPath);
  const record: AttachedProjectRecord = {
    path: absolutePath,
    attachedAt: new Date().toISOString(),
    agentsFile: existsSync(join(absolutePath, 'AGENTS.md')) ? join(absolutePath, 'AGENTS.md') : null,
    codexConfig: existsSync(join(absolutePath, '.codex', 'config.toml')) ? join(absolutePath, '.codex', 'config.toml') : null,
    synapticConfig: existsSync(join(absolutePath, '.codex-synaptic', 'project.json'))
      ? join(absolutePath, '.codex-synaptic', 'project.json')
      : null
  };

  const store = readStore();
  const filtered = store.projects.filter((project) => project.path !== absolutePath);
  filtered.push(record);
  writeStore({ projects: filtered });

  return record;
}

export function listAttachedProjects(): AttachedProjectRecord[] {
  return readStore().projects.sort((a, b) => b.attachedAt.localeCompare(a.attachedAt));
}
