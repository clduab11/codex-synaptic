import type { SpawnCommandResult } from '../cli/doctor.js';

export interface OptionalEngineStatus {
  name: 'ruflo' | 'ruv-fann';
  available: boolean;
  version: string;
}

export type SpawnLike = (
  command: string,
  args: string[],
  options: { cwd: string; encoding: BufferEncoding }
) => Promise<SpawnCommandResult>;

async function detectVersion(
  spawnCommand: SpawnLike,
  cwd: string,
  name: 'ruflo' | 'ruv-fann'
): Promise<OptionalEngineStatus> {
  const result = await spawnCommand(name, ['--version'], { cwd, encoding: 'utf8' });
  return {
    name,
    available: result.status === 0,
    version: (result.stdout || result.stderr || '').trim()
  };
}

export async function detectOptionalEngines(
  spawnCommand: SpawnLike,
  cwd: string
): Promise<OptionalEngineStatus[]> {
  return Promise.all([
    detectVersion(spawnCommand, cwd, 'ruflo'),
    detectVersion(spawnCommand, cwd, 'ruv-fann')
  ]);
}

export async function invokeRufloAdapter(
  spawnCommand: SpawnLike,
  cwd: string,
  args: string[]
): Promise<SpawnCommandResult> {
  return spawnCommand('ruflo', args, { cwd, encoding: 'utf8' });
}

export async function invokeRuvFannAdapter(
  spawnCommand: SpawnLike,
  cwd: string,
  args: string[]
): Promise<SpawnCommandResult> {
  return spawnCommand('ruv-fann', args, { cwd, encoding: 'utf8' });
}
