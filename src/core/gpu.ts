import { EventEmitter } from 'events';
import { spawnSync } from 'child_process';
import os from 'os';
import { Logger } from './logger.js';

export type GPUBackend = 'cuda' | 'mps';

export interface GPUDevice {
  backend: GPUBackend;
  name: string;
  memoryMB?: number;
  driverVersion?: string;
}

export interface GPUStatus {
  availableBackends: GPUBackend[];
  devices: GPUDevice[];
  selectedBackend: GPUBackend | 'cpu';
  diagnostics: string[];
  detectedAt: Date;
}

const DEFAULT_STATUS: GPUStatus = {
  availableBackends: [],
  devices: [],
  selectedBackend: 'cpu',
  diagnostics: [],
  detectedAt: new Date(0)
};

const DEFAULT_PROBE_CACHE_TTL_MS = 5 * 60 * 1000;

export class GPUManager extends EventEmitter {
  private readonly logger = Logger.getInstance();
  private status: GPUStatus = { ...DEFAULT_STATUS };
  private cache: { status: GPUStatus; timestamp: number } | null = null;
  private probeCacheTtlMs = DEFAULT_PROBE_CACHE_TTL_MS;
  private disableCache = ['1', 'true', 'TRUE'].includes(process.env.CODEX_GPU_PROBE_DISABLE_CACHE ?? '');

  async initialize(): Promise<void> {
    this.logger.info('gpu', 'Initializing GPU manager');
    this.refreshStatus(true);
    this.logger.info('gpu', 'GPU detection completed', { status: this.status });
  }

  async shutdown(): Promise<void> {
    this.logger.info('gpu', 'GPU manager shutdown');
  }

  getStatus(): GPUStatus {
    return {
      ...this.status,
      devices: this.status.devices.map((device) => ({ ...device })),
      diagnostics: [...this.status.diagnostics]
    };
  }

  isBackendAvailable(backend: GPUBackend): boolean {
    return this.status.availableBackends.includes(backend);
  }

  setProbeCacheOptions(options: { disableCache?: boolean; probeCacheTtlMs?: number }): void {
    if (typeof options.disableCache === 'boolean') {
      this.disableCache = options.disableCache;
    }

    if (typeof options.probeCacheTtlMs === 'number' && options.probeCacheTtlMs >= 0) {
      this.probeCacheTtlMs = options.probeCacheTtlMs;
    }
  }

  refreshStatus(force = false): void {
    const now = Date.now();

    if (!force && !this.disableCache && this.cache) {
      const age = now - this.cache.timestamp;
      if (age < this.probeCacheTtlMs) {
        this.status = this.cloneStatus(this.cache.status);
        this.logger.debug('gpu', 'Using cached GPU probe results', { ageMs: age });
        this.applyEnvironmentHints();
        this.emit('statusChanged', this.getStatus());
        return;
      }
    }

    const probedStatus = this.performProbe();
    this.status = probedStatus;

    if (!this.disableCache) {
      this.cache = { status: this.cloneStatus(probedStatus), timestamp: now };
    } else {
      this.cache = null;
    }

    this.applyEnvironmentHints();
    this.emit('statusChanged', this.getStatus());
  }

  private detectCuda(): { available: boolean; devices: GPUDevice[]; diagnostics: string[] } {
    const diagnostics: string[] = [];

    const nvCheck = spawnSync('which', ['nvidia-smi'], { encoding: 'utf8' });
    if (nvCheck.status !== 0) {
      diagnostics.push('CUDA detection: nvidia-smi not found on PATH.');
      return { available: false, devices: [], diagnostics };
    }

    const query = spawnSync('nvidia-smi', ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader'], {
      encoding: 'utf8',
      timeout: 3000
    });

    if (query.error) {
      diagnostics.push(`CUDA detection error: ${query.error.message}`);
      return { available: false, devices: [], diagnostics };
    }

    if (query.status !== 0) {
      diagnostics.push(`CUDA detection exited with code ${query.status}: ${query.stderr?.trim()}`);
      return { available: false, devices: [], diagnostics };
    }

    const devices: GPUDevice[] = [];
    const lines = query.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      const parts = line.split(',').map((part) => part.trim());
      if (!parts.length) continue;
      const [namePart, memoryPart, driverPart] = parts;
      let memoryMB: number | undefined;
      if (memoryPart) {
        const match = memoryPart.match(/([0-9.]+)\s*MiB/i);
        if (match) {
          memoryMB = Number.parseFloat(match[1]);
        }
      }
      devices.push({
        backend: 'cuda',
        name: namePart || 'CUDA GPU',
        memoryMB,
        driverVersion: driverPart
      });
    }

    if (!devices.length) {
      diagnostics.push('CUDA detection: no devices reported by nvidia-smi.');
      return { available: false, devices: [], diagnostics };
    }

    return { available: true, devices, diagnostics };
  }

  private detectMps(): { available: boolean; devices: GPUDevice[]; diagnostics: string[] } {
    const diagnostics: string[] = [];
    if (process.platform !== 'darwin') {
      diagnostics.push('MPS detection skipped: not running on macOS.');
      return { available: false, devices: [], diagnostics };
    }

    // When CI=true, avoid expensive hardware probes
    if (process.env.CI === 'true' || process.env.CI === '1') {
      diagnostics.push('MPS detection skipped due to CI environment.');
      return { available: false, devices: [], diagnostics };
    }

    const profiler = spawnSync('system_profiler', ['SPDisplaysDataType'], {
      encoding: 'utf8',
      timeout: 4000
    });

    if (profiler.error) {
      diagnostics.push(`MPS detection error: ${profiler.error.message}`);
      return { available: false, devices: [], diagnostics };
    }

    if (profiler.status !== 0) {
      diagnostics.push(`MPS detection exited with code ${profiler.status}`);
      return { available: false, devices: [], diagnostics };
    }

    const stdout = profiler.stdout;
    const devices: GPUDevice[] = [];
    const lines = stdout.split('\n');

    interface PendingDevice {
      headerName: string;
      chipset?: string;
      memoryMB?: number;
    }

    const flush = (pending: PendingDevice | null) => {
      if (!pending) return;
      const name = pending.chipset ?? pending.headerName ?? `${os.hostname()} GPU`;
      devices.push({
        backend: 'mps',
        name,
        memoryMB: pending.memoryMB
      });
    };

    let pending: PendingDevice | null = null;
    let metalSupported = false;

    for (const rawLine of lines) {
      const indent = rawLine.match(/^(\s*)/)?.[1].length ?? 0;
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      if (indent === 4 && line.endsWith(':')) {
        flush(pending);
        pending = { headerName: line.slice(0, -1).trim() };
        continue;
      }

      if (!pending) {
        continue;
      }

      if (indent >= 6 && line.includes(':')) {
        const [keyRaw, valueRaw] = line.split(':', 2);
        const key = keyRaw.trim();
        const value = (valueRaw ?? '').trim();

        if (/^Chipset Model$/i.test(key)) {
          pending.chipset = value;
        } else if (/^VRAM/i.test(key) || /Memory:/i.test(key)) {
          const match = value.match(/([0-9.]+)\s*(GB|MB)/i);
          if (match) {
            const size = Number.parseFloat(match[1]);
            if (!Number.isNaN(size)) {
              pending.memoryMB = match[2].toUpperCase() === 'GB' ? size * 1024 : size;
            }
          }
        } else if (/^Metal(\s+Support)?$/i.test(key)) {
          if (!/not\s+supported/i.test(value)) {
            if (/supported/i.test(value) || /metal\s+\d+/i.test(value) || /family/i.test(value)) {
              metalSupported = true;
            }
          }
        }
      }
    }

    flush(pending);

    if (!devices.length) {
      diagnostics.push('MPS detection: no GPU devices reported by system_profiler.');
      return { available: false, devices: [], diagnostics };
    }

    if (!metalSupported) {
      diagnostics.push('MPS detection: Metal support not reported as available.');
      return { available: false, devices, diagnostics };
    }

    return { available: true, devices, diagnostics };
  }

  private applyEnvironmentHints(): void {
    const status = this.status;
    if (status.selectedBackend === 'cuda') {
      process.env.CODEX_GPU_BACKEND = 'cuda';
      if (!process.env.CUDA_VISIBLE_DEVICES) {
        process.env.CUDA_VISIBLE_DEVICES = '0';
      }
    } else if (status.selectedBackend === 'mps') {
      process.env.CODEX_GPU_BACKEND = 'mps';
      process.env.MPS_AVAILABLE = '1';
      if (!process.env.TORCH_USE_MPS) {
        process.env.TORCH_USE_MPS = '1';
      }
    } else {
      process.env.CODEX_GPU_BACKEND = 'cpu';
    }
    process.env.CODEX_GPU_DEVICES = JSON.stringify(status.devices.map((d) => ({
      backend: d.backend,
      name: d.name,
      memoryMB: d.memoryMB,
      driverVersion: d.driverVersion
    })));
  }

  private performProbe(): GPUStatus {
    const diagnostics: string[] = [];
    const devices: GPUDevice[] = [];
    const availableBackends: GPUBackend[] = [];

    const cuda = this.detectCuda();
    diagnostics.push(...cuda.diagnostics);
    if (cuda.available) {
      availableBackends.push('cuda');
      devices.push(...cuda.devices);
    }

    const mps = this.detectMps();
    diagnostics.push(...mps.diagnostics);
    if (mps.available) {
      availableBackends.push('mps');
      devices.push(...mps.devices);
    }

    const selectedBackend: GPUStatus['selectedBackend'] = availableBackends.includes('cuda')
      ? 'cuda'
      : availableBackends.includes('mps')
        ? 'mps'
        : 'cpu';

    return {
      availableBackends,
      devices,
      selectedBackend,
      diagnostics,
      detectedAt: new Date()
    };
  }

  private cloneStatus(status: GPUStatus): GPUStatus {
    return {
      availableBackends: [...status.availableBackends],
      devices: status.devices.map((device) => ({ ...device })),
      selectedBackend: status.selectedBackend,
      diagnostics: [...status.diagnostics],
      detectedAt: new Date(status.detectedAt)
    };
  }
}
