import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Store } from '../src/lib/store.js';
import { Embedder } from '../src/lib/embedder.js';
import { IndexPipeline } from '../src/lib/index-pipeline.js';
import { KnowledgeGraph } from '../src/lib/graph.js';
import { Search } from '../src/lib/search.js';
import { resolveNodeName } from '../src/lib/resolve.js';
import { buildFullNodeResult } from '../src/lib/node-output.js';

describe('Integration: full pipeline', () => {
  let store: Store;
  let embedder: Embedder;
  let kg: KnowledgeGraph;
  let search: Search;
  let fixtureVault: string;

  beforeAll(async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const input = JSON.parse(String(init?.body)).input as string;
      return {
        ok: true,
        json: async () => ({ data: [{ embedding: vectorFor(input) }] }),
      };
    }));

    fixtureVault = await makeVault();
    store = new Store(':memory:');
    embedder = new Embedder();
    await embedder.init();

    const pipeline = new IndexPipeline(store, embedder);
    await pipeline.index(fixtureVault);

    kg = KnowledgeGraph.fromStore(store);
    search = new Search(store, embedder);
  });

  afterAll(async () => {
    store.close();
    await embedder.dispose();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('name resolution finds Alice by alias', () => {
    const matches = resolveNodeName('A. Smith', store);
    expect(matches).toHaveLength(1);
    expect(matches[0].nodeId).toBe('wiki/People/Alice Smith.md');
  });

  it('node lookup returns content and connections', () => {
    const node = store.getNode('wiki/People/Alice Smith.md');
    expect(node).toBeDefined();
    expect(node!.title).toBe('Alice Smith');
    const outgoing = store.getEdgesFrom('wiki/People/Alice Smith.md');
    expect(outgoing.length).toBeGreaterThan(0);
  });

  it('full node output uses canonical markdown and compact links', () => {
    const node = store.getNode('wiki/People/Alice Smith.md');
    expect(node).toBeDefined();

    const result = buildFullNodeResult(store, node!, fixtureVault, 2000);

    expect(result.format).toBe('markdown');
    expect(result.contentSource).toBe('vault-file');
    expect(result.content).toContain('---\ntitle: Alice Smith');
    expect(result.content).toContain('[[Widget Theory]]');
    expect(result.outgoing).toEqual([
      { nodeId: 'wiki/Concepts/Widget Theory.md', title: 'Widget Theory' },
      { nodeId: 'wiki/Ideas/Acme Project.md', title: 'Acme Project' },
    ]);
    expect(JSON.stringify(result)).not.toContain('context');
  });

  it('excludes root, raw, and inbox notes from the operational graph', () => {
    expect(store.getNode('README.md')).toBeUndefined();
    expect(store.getNode('raw/transcript.md')).toBeUndefined();
    expect(store.getNode('inbox/capture.md')).toBeUndefined();
  });

  it('neighbors returns connected wiki nodes', () => {
    const neighbors = kg.neighbors('wiki/People/Alice Smith.md', 1);
    const titles = neighbors.map(n => n.title);
    expect(titles).toContain('Widget Theory');
  });

  it('semantic search finds relevant nodes through OpenAI query embeddings', async () => {
    const results = await search.semantic('design pattern for components');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].nodeId).toBe('wiki/Concepts/Widget Theory.md');
  });

  it('fulltext search finds exact keywords in full wiki note content', () => {
    const results = search.fulltext('resilient components');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].nodeId).toBe('wiki/Concepts/Widget Theory.md');
  });

  it('finds paths between Alice and Acme Project', () => {
    const paths = kg.findPaths(
      'wiki/People/Alice Smith.md',
      'wiki/Ideas/Acme Project.md',
      3,
    );
    expect(paths.length).toBeGreaterThan(0);
  });

  it('finds common neighbors between Alice and Bob', () => {
    const common = kg.commonNeighbors(
      'wiki/People/Alice Smith.md',
      'wiki/People/Bob Jones.md',
    );
    const titles = common.map(n => n.title);
    expect(titles).toContain('Widget Theory');
  });

  it('extracts subgraph around Widget Theory', () => {
    const sub = kg.subgraph('wiki/Concepts/Widget Theory.md', 1);
    expect(sub.nodes.length).toBeGreaterThan(1);
    expect(sub.edges.length).toBeGreaterThan(0);
  });

  it('communities are detected', () => {
    const communities = store.getAllCommunities();
    expect(communities.length).toBeGreaterThan(0);
  });

  it('bridges are computed', () => {
    const bridges = kg.bridges(10);
    expect(bridges.length).toBeGreaterThan(0);
  });

  it('central nodes are computed', () => {
    const central = kg.centralNodes(10);
    expect(central.length).toBeGreaterThan(0);
  });

  it('wiki orphan node exists but is isolated', () => {
    const orphan = store.getNode('wiki/orphan.md');
    expect(orphan).toBeDefined();
    const neighbors = kg.neighbors('wiki/orphan.md', 1);
    expect(neighbors).toHaveLength(0);
  });
});

async function makeVault(): Promise<string> {
  const vault = await mkdtemp(join(tmpdir(), 'kg-integration-vault-'));
  await mkdir(join(vault, 'wiki', 'People'), { recursive: true });
  await mkdir(join(vault, 'wiki', 'Concepts'), { recursive: true });
  await mkdir(join(vault, 'wiki', 'Ideas'), { recursive: true });
  await mkdir(join(vault, 'raw'), { recursive: true });
  await mkdir(join(vault, 'inbox'), { recursive: true });

  await writeFile(join(vault, 'README.md'), '# Root');
  await writeFile(join(vault, 'raw', 'transcript.md'), '# Raw transcript with resilient components');
  await writeFile(join(vault, 'inbox', 'capture.md'), '# Inbox capture');
  await writeFile(join(vault, 'wiki', 'People', 'Alice Smith.md'), `---
title: Alice Smith
aliases: [A. Smith]
---
Alice researches [[Widget Theory]] and collaborates on [[Acme Project]].
`);
  await writeFile(join(vault, 'wiki', 'People', 'Bob Jones.md'), `---
title: Bob Jones
---
Bob also researches [[Widget Theory]].
`);
  await writeFile(join(vault, 'wiki', 'Concepts', 'Widget Theory.md'), `---
title: Widget Theory
tags: [concept, components]
---
Widget Theory is a design pattern for resilient components in distributed systems.
`);
  await writeFile(join(vault, 'wiki', 'Ideas', 'Acme Project.md'), `---
title: Acme Project
---
The Acme Project applies [[Widget Theory]] with [[Alice Smith]].
`);
  await writeFile(join(vault, 'wiki', 'orphan.md'), '# Orphan\nNo links here.');
  return vault;
}

function vectorFor(text: string): number[] {
  const lower = text.toLowerCase();
  const vector = new Array(1536).fill(0);
  if (lower.includes('design pattern') || lower.startsWith('widget theory\n')) {
    vector[0] = 1;
  } else if (lower.includes('widget')) {
    vector[3] = 1;
  } else if (lower.includes('cake')) {
    vector[1] = 1;
  } else {
    vector[2] = 1;
  }
  return vector;
}
