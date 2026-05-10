import { describe, it, expect, vi, afterEach } from 'vitest';
import { VaultWatcher } from '../src/lib/watcher.js';
import type { IndexStats } from '../src/lib/index-pipeline.js';

function stats(): IndexStats {
  return {
    nodesIndexed: 1,
    nodesSkipped: 0,
    edgesIndexed: 1,
    communitiesDetected: 1,
    stubNodesCreated: 0,
    chunksIndexed: 1,
    chunksSkipped: 0,
  };
}

describe('VaultWatcher', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces repeated change events into one index run', async () => {
    vi.useFakeTimers();
    const index = vi.fn(async () => stats());
    const watcher = new VaultWatcher({
      vaultPath: '/tmp/vault',
      debounceMs: 100,
      initialIndex: false,
      index,
    });

    watcher.schedule('change one');
    watcher.schedule('change two');
    await vi.advanceTimersByTimeAsync(99);
    expect(index).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(index).toHaveBeenCalledTimes(1);
  });

  it('runs a pending index after changes arrive during an active index', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const firstRun = new Promise<IndexStats>(resolve => {
      release = () => resolve(stats());
    });
    const index = vi
      .fn<() => Promise<IndexStats>>()
      .mockReturnValueOnce(firstRun)
      .mockResolvedValue(stats());
    const watcher = new VaultWatcher({
      vaultPath: '/tmp/vault',
      debounceMs: 100,
      initialIndex: false,
      index,
    });

    watcher.schedule('first');
    await vi.advanceTimersByTimeAsync(100);
    expect(index).toHaveBeenCalledTimes(1);

    watcher.schedule('second');
    await vi.advanceTimersByTimeAsync(100);
    expect(index).toHaveBeenCalledTimes(1);

    release();
    await vi.runAllTimersAsync();
    expect(index).toHaveBeenCalledTimes(2);
  });
});
