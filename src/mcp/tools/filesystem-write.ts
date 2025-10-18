import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { MCPTool } from '../types.js';
import { describeProjectsRoot, resolveProjectsRoot } from '../../utils/projects-root.js';

export interface FilesystemWriteParams {
  path: string;
  content: string;
  encoding?: 'utf8' | 'base64';
  append?: boolean;
}

export class FilesystemWriteTool implements MCPTool {
  readonly name = 'filesystem_write_asset';
  readonly description = 'Persist generated artifacts within the user projects workspace boundary.';

  async execute(params: FilesystemWriteParams): Promise<{ path: string; bytesWritten: number }> {
    if (!params || typeof params.path !== 'string' || params.path.trim().length === 0) {
      throw new Error('filesystem_write_asset requires a non-empty path parameter.');
    }
    if (typeof params.content !== 'string') {
      throw new Error('filesystem_write_asset requires a string content parameter.');
    }

    const root = resolveProjectsRoot();
    const normalizedPath = params.path.replace(/\\/g, '/');
    const targetPath = resolve(root, normalizedPath);

    if (!targetPath.startsWith(root)) {
      throw new Error(
        `filesystem_write_asset path must reside within the ${describeProjectsRoot()} directory.`
      );
    }

    const payload = params.encoding === 'base64' ? Buffer.from(params.content, 'base64') : params.content;
    await fs.mkdir(dirname(targetPath), { recursive: true });

    if (params.append) {
      await fs.appendFile(targetPath, payload);
      const stats = await fs.stat(targetPath);
      return { path: targetPath, bytesWritten: stats.size };
    }

    await fs.writeFile(targetPath, payload);
    const stats = await fs.stat(targetPath);
    return { path: targetPath, bytesWritten: stats.size };
  }
}