import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Store } from '../src/lib/store.js';
import { Embedder } from '../src/lib/embedder.js';
import { Search } from '../src/lib/search.js';

describe('Search', () => {
  let store: Store;
  let embedder: Embedder;
  let search: Search;

  beforeAll(async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const input = JSON.parse(String(init?.body)).input as string;
      return {
        ok: true,
        json: async () => ({ data: [{ embedding: vectorFor(input) }] }),
      };
    }));

    store = new Store(':memory:');
    embedder = new Embedder();
    await embedder.init();
    search = new Search(store, embedder);

    const nodes = [
      { id: 'graph.md', title: 'Graph Theory', content: 'Study of mathematical structures used to model pairwise relations', frontmatter: {} },
      { id: 'cake.md', title: 'Chocolate Cake', content: 'A delicious dessert made with cocoa powder and sugar', frontmatter: {} },
      { id: 'network.md', title: 'Network Analysis', content: 'Analysis of graph structures in social networks', frontmatter: {} },
    ];

    for (const node of nodes) {
      store.upsertNode(node);
      const text = Embedder.buildEmbeddingText(node.title, [], node.content);
      const embedding = await embedder.embed(text);
      store.upsertEmbedding(node.id, embedding);
    }

    for (const chunk of [
      {
        id: 'raw/zuhair.md#chunk-0',
        documentId: 'raw/zuhair.md',
        sourceKind: 'raw' as const,
        headingPath: ['Call'],
        chunkIndex: 0,
        startToken: 0,
        endToken: 20,
        text: 'Zuhair thinks OpenAI models are strong but expensive.',
        mtime: 100,
      },
      {
        id: 'wiki/sources/source.md#chunk-0',
        documentId: 'wiki/sources/source.md',
        sourceKind: 'wiki-sources' as const,
        headingPath: ['Source'],
        chunkIndex: 0,
        startToken: 0,
        endToken: 20,
        text: 'A source note about graph structures.',
        mtime: 100,
      },
    ]) {
      store.upsertChunk(chunk);
      store.upsertChunkEmbedding(chunk.id, await embedder.embed(chunk.text));
    }
  });

  afterAll(async () => {
    store.close();
    await embedder.dispose();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('semantic search returns relevant results via OpenAI query embeddings', async () => {
    const results = await search.semantic('graph structures and relationships');
    expect(results.length).toBeGreaterThan(0);
    const ids = results.map(r => r.nodeId);
    const graphIdx = ids.indexOf('graph.md');
    const cakeIdx = ids.indexOf('cake.md');
    expect(graphIdx).toBeGreaterThanOrEqual(0);
    expect(cakeIdx).toBeGreaterThanOrEqual(0);
    expect(graphIdx).toBeLessThan(cakeIdx);
    expect(fetch).toHaveBeenCalled();
  });

  it('fulltext search returns exact keyword matches without embedding calls', () => {
    const callsBefore = vi.mocked(fetch).mock.calls.length;
    const results = search.fulltext('cocoa powder');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].nodeId).toBe('cake.md');
    expect(vi.mocked(fetch).mock.calls.length).toBe(callsBefore);
  });

  it('chunk search returns relevant passages and supports filters', async () => {
    const results = await search.chunks('what does zuhair think of openai?', {
      limit: 5,
      sourceKind: 'raw',
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      chunkId: 'raw/zuhair.md#chunk-0',
      documentId: 'raw/zuhair.md',
      sourceKind: 'raw',
      headingPath: ['Call'],
    });
    expect(results[0].text).toContain('OpenAI');

    const scoped = await search.chunks('openai', {
      limit: 5,
      documentId: 'wiki/sources/source.md',
    });
    expect(scoped.every(r => r.documentId === 'wiki/sources/source.md')).toBe(true);
  });
});

function vectorFor(text: string): number[] {
  const lower = text.toLowerCase();
  const vector = new Array(1536).fill(0);
  if (lower.includes('zuhair') || lower.includes('openai')) {
    vector[2] = 1;
  } else if (lower.includes('cake') || lower.includes('cocoa') || lower.includes('dessert')) {
    vector[1] = 1;
  } else {
    vector[0] = 1;
  }
  return vector;
}
