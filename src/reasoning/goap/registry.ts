import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { Logger } from '../../core/logger.js';
import type { GoapManifest } from './types.js';

export class GoapRegistry {
  private readonly logger = Logger.getInstance('goap');
  private readonly manifests: Map<string, GoapManifest> = new Map();
  private isLoaded = false;
  private readonly manifestDir = resolve(process.cwd(), 'config', 'goap');

  async getManifest(id: string): Promise<GoapManifest | undefined> {
    await this.ensureLoaded();
    return this.manifests.get(id);
  }

  async matchManifest(prompt: string): Promise<GoapManifest | undefined> {
    await this.ensureLoaded();
    const normalizedPrompt = prompt.toLowerCase();
    for (const manifest of this.manifests.values()) {
      const triggers = manifest.triggers;
      if (!triggers) {
        continue;
      }
      if (triggers.phrases?.some((phrase) => normalizedPrompt.includes(phrase.toLowerCase()))) {
        return manifest;
      }
      if (triggers.patterns) {
        for (const pattern of triggers.patterns) {
          try {
            const regex = new RegExp(pattern, 'i');
            if (regex.test(prompt)) {
              return manifest;
            }
          } catch (error) {
            this.logger.warn('goap', 'Invalid GOAP trigger regex', { pattern }, error as Error);
          }
        }
      }
    }
    return undefined;
  }

  async listManifests(): Promise<GoapManifest[]> {
    await this.ensureLoaded();
    return Array.from(this.manifests.values());
  }

  private async ensureLoaded(): Promise<void> {
    if (this.isLoaded) {
      return;
    }

    try {
      const entries = await fs.readdir(this.manifestDir);
      for (const entry of entries) {
        if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) {
          continue;
        }
        const manifestPath = resolve(this.manifestDir, entry);
        try {
          const fileContent = await fs.readFile(manifestPath, 'utf8');
          const parsed = load(fileContent) as GoapManifest;
          if (!parsed || typeof parsed !== 'object') {
            this.logger.warn('goap', 'GOAP manifest skipped due to invalid structure', { manifestPath });
            continue;
          }
          if (!parsed.id) {
            this.logger.warn('goap', 'GOAP manifest missing id', { manifestPath });
            continue;
          }
          if (!parsed.goals?.length) {
            this.logger.warn('goap', 'GOAP manifest missing goals', { manifestId: parsed.id });
            continue;
          }
          this.manifests.set(parsed.id, parsed);
        } catch (error) {
          this.logger.error('goap', 'Failed to load GOAP manifest', { manifestPath }, error as Error);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.error('goap', 'Failed to read GOAP manifest directory', undefined, error as Error);
      } else {
        this.logger.info('goap', 'GOAP manifest directory not present; skipping registry preload');
      }
    } finally {
      this.isLoaded = true;
    }
  }
}

export const goapRegistry = new GoapRegistry();