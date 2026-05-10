import chokidar, { type FSWatcher } from 'chokidar';
import { join } from 'path';
import type { IndexStats } from './index-pipeline.js';

export interface VaultWatcherOptions {
  vaultPath: string;
  debounceMs: number;
  initialIndex: boolean;
  index: () => Promise<IndexStats>;
  onIndexStart?: (reason: string) => void;
  onIndexComplete?: (stats: IndexStats) => void;
  onError?: (error: unknown) => void;
}

export class VaultWatcher {
  private watcher?: FSWatcher;
  private timer?: NodeJS.Timeout;
  private indexing = false;
  private pending = false;
  private lastReason = 'startup';

  constructor(private options: VaultWatcherOptions) {}

  async start(): Promise<void> {
    this.watcher = chokidar.watch([
      join(this.options.vaultPath, 'wiki/**/*.md'),
      join(this.options.vaultPath, 'raw/**/*.md'),
    ], {
      ignoreInitial: true,
      ignored: [
        '**/.obsidian/**',
        '**/.stfolder/**',
        '**/.stversions/**',
        '**/.git/**',
        '**/node_modules/**',
        '**/.DS_Store',
        '**/*.tmp',
        '**/*.swp',
      ],
      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 100,
      },
    });

    this.watcher
      .on('add', path => this.schedule(`added ${path}`))
      .on('change', path => this.schedule(`changed ${path}`))
      .on('unlink', path => this.schedule(`deleted ${path}`))
      .on('error', error => this.options.onError?.(error));

    if (this.options.initialIndex) {
      await this.runIndex('startup');
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    await this.watcher?.close();
  }

  schedule(reason: string): void {
    this.lastReason = reason;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.runIndex(this.lastReason);
    }, this.options.debounceMs);
  }

  private async runIndex(reason: string): Promise<void> {
    if (this.indexing) {
      this.pending = true;
      return;
    }

    this.indexing = true;
    this.options.onIndexStart?.(reason);
    try {
      const stats = await this.options.index();
      this.options.onIndexComplete?.(stats);
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.indexing = false;
      if (this.pending) {
        this.pending = false;
        await this.runIndex('pending changes');
      }
    }
  }
}
