import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Store } from '../src/lib/store.js';
import { Embedder } from '../src/lib/embedder.js';
import { IndexPipeline } from '../src/lib/index-pipeline.js';

describe('IndexPipeline', () => {
  let store: Store;
  let embedder: Embedder;
  let pipeline: IndexPipeline;
  let fixtureVault: string;

  beforeAll(async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ embedding: new Array(1536).fill(0.1) }] }),
    })));

    fixtureVault = await makeVault();
    store = new Store(':memory:');
    embedder = new Embedder();
    await embedder.init();
    pipeline = new IndexPipeline(store, embedder);
  });

  afterAll(async () => {
    store.close();
    await embedder.dispose();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('indexes only wiki notes from the fixture vault', async () => {
    const stats = await pipeline.index(fixtureVault);
    expect(stats.nodesIndexed).toBe(4);
    expect(stats.edgesIndexed).toBe(1);
    expect(stats.stubNodesCreated).toBe(0);
    expect(stats.chunksIndexed).toBeGreaterThan(0);

    const alice = store.getNode('wiki/People/Alice Smith.md');
    expect(alice).toBeDefined();
    expect(alice!.title).toBe('Alice Smith');
    expect(store.getNode('README.md')).toBeUndefined();
    expect(store.getNode('raw/transcript.md')).toBeUndefined();

    const edges = store.getEdgesFrom('wiki/People/Alice Smith.md');
    expect(edges).toHaveLength(1);
    expect(edges[0].targetId).toBe('wiki/Concepts/Widget Theory.md');
    expect(store.getChunkDocumentIds()).toEqual(new Set([
      'raw/transcript.md',
      'wiki/sources/source.md',
    ]));
  });

  it('detects communities', async () => {
    const communities = store.getAllCommunities();
    expect(communities.length).toBeGreaterThan(0);
  });

  it('is incremental (skips unchanged wiki files)', async () => {
    const freshStore = new Store(':memory:');
    const freshPipeline = new IndexPipeline(freshStore, embedder);

    const first = await freshPipeline.index(fixtureVault);
    expect(first.nodesIndexed).toBe(4);

    const second = await freshPipeline.index(fixtureVault);
    expect(second.nodesIndexed).toBe(0);
    expect(second.nodesSkipped).toBe(first.nodesIndexed);
    expect(second.chunksIndexed).toBe(0);
    expect(second.chunksSkipped).toBe(2);

    freshStore.close();
  });

  it('removes chunks for deleted raw files', async () => {
    const vault = await makeVault();
    const freshStore = new Store(':memory:');
    const freshPipeline = new IndexPipeline(freshStore, embedder);

    await freshPipeline.index(vault);
    expect(freshStore.getChunkDocumentIds()).toContain('raw/transcript.md');

    await rm(join(vault, 'raw', 'transcript.md'));
    await freshPipeline.index(vault);
    expect(freshStore.getChunkDocumentIds()).not.toContain('raw/transcript.md');

    freshStore.close();
  });
});

async function makeVault(): Promise<string> {
  const vault = await mkdtemp(join(tmpdir(), 'kg-pipeline-vault-'));
  await mkdir(join(vault, 'wiki', 'People'), { recursive: true });
  await mkdir(join(vault, 'wiki', 'Concepts'), { recursive: true });
  await mkdir(join(vault, 'wiki', 'sources'), { recursive: true });
  await mkdir(join(vault, 'raw'), { recursive: true });
  await writeFile(join(vault, 'README.md'), '# Root');
  await writeFile(join(vault, 'raw', 'transcript.md'), '# Raw\nZuhair discussed OpenAI in a long transcript.');
  await writeFile(join(vault, 'wiki', 'People', 'Alice Smith.md'), `---
title: Alice Smith
tags: [person]
---
Alice studies [[Widget Theory]] and mentions [[raw/transcript]].
`);
  await writeFile(join(vault, 'wiki', 'People', 'Bob Jones.md'), '# Bob Jones');
  await writeFile(join(vault, 'wiki', 'Concepts', 'Widget Theory.md'), '# Widget Theory');
  await writeFile(join(vault, 'wiki', 'sources', 'source.md'), '# Source\nA curated source note with details.');
  return vault;
}
