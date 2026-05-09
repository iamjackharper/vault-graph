import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import matter from 'gray-matter';
import { parseVault } from './parser.js';
import type { Store } from './store.js';
import { Embedder } from './embedder.js';
import { KnowledgeGraph } from './graph.js';
import { buildChunkEmbeddingText, chunkMarkdown } from './chunker.js';
import type { ChunkSourceKind } from './types.js';

export interface IndexStats {
  nodesIndexed: number;
  nodesSkipped: number;
  edgesIndexed: number;
  communitiesDetected: number;
  stubNodesCreated: number;
  chunksIndexed: number;
  chunksSkipped: number;
}

export class IndexPipeline {
  constructor(
    private store: Store,
    private embedder: Embedder,
  ) {}

  async index(vaultPath: string, resolution = 1.0): Promise<IndexStats> {
    const stats: IndexStats = {
      nodesIndexed: 0,
      nodesSkipped: 0,
      edgesIndexed: 0,
      communitiesDetected: 0,
      stubNodesCreated: 0,
      chunksIndexed: 0,
      chunksSkipped: 0,
    };

    const { nodes, edges, stubIds } = await parseVault(vaultPath);
    const chunkDocuments = await collectChunkDocuments(vaultPath);
    const previousPaths = this.store.getAllSyncPaths();

    // Detect deleted files
    const currentPaths = new Set(nodes.map(n => n.id));
    for (const oldPath of previousPaths) {
      if (!currentPaths.has(oldPath)) {
        this.store.deleteNode(oldPath);
      }
    }

    const currentChunkDocuments = new Set(chunkDocuments.map(d => d.id));
    for (const oldDocumentId of this.store.getChunkDocumentIds()) {
      if (!currentChunkDocuments.has(oldDocumentId)) {
        this.store.deleteChunksForDocument(oldDocumentId);
      }
    }

    // Index nodes (incremental)
    for (const node of nodes) {
      const fileStat = await stat(join(vaultPath, node.id));
      const mtime = fileStat.mtimeMs;
      const prevMtime = this.store.getSyncMtime(node.id);

      if (prevMtime !== undefined && prevMtime >= mtime) {
        stats.nodesSkipped++;
        continue;
      }

      this.store.upsertNode(node);

      // Compute and store embedding
      const tags = extractTags(node.frontmatter);
      const text = this.embedder.buildEmbeddingText(node.title, tags, node.content);
      const embedding = await this.embedder.embed(text);
      this.store.upsertEmbedding(node.id, embedding);

      // Re-index edges from this node
      this.store.deleteAllEdgesFrom(node.id);
      for (const edge of edges.filter(e => e.sourceId === node.id)) {
        this.store.insertEdge(edge);
        stats.edgesIndexed++;
      }

      this.store.upsertSync(node.id, mtime);
      stats.nodesIndexed++;
    }

    for (const doc of chunkDocuments) {
      const prevMtime = this.store.getChunkDocumentMtime(doc.id);
      if (prevMtime !== undefined && prevMtime >= doc.mtime) {
        stats.chunksSkipped++;
        continue;
      }

      this.store.deleteChunksForDocument(doc.id);
      const chunks = chunkMarkdown(doc.id, doc.content, doc.sourceKind, { mtime: doc.mtime });
      for (const chunk of chunks) {
        this.store.upsertChunk(chunk);
        const embedding = await this.embedder.embed(buildChunkEmbeddingText(chunk));
        this.store.upsertChunkEmbedding(chunk.id, embedding);
        stats.chunksIndexed++;
      }
    }

    // Create stub nodes
    for (const stubId of stubIds) {
      if (!this.store.getNode(stubId)) {
        this.store.upsertNode({
          id: stubId,
          title: stubId.replace('_stub/', '').replace('.md', ''),
          content: '',
          frontmatter: { _stub: true },
        });
        stats.stubNodesCreated++;
      }
    }

    // If any nodes were indexed, re-run community detection
    if (stats.nodesIndexed > 0 || stats.stubNodesCreated > 0) {
      const kg = KnowledgeGraph.fromStore(this.store);
      const communities = kg.detectCommunities(resolution);
      this.store.clearCommunities();
      for (const c of communities) {
        this.store.upsertCommunity(c);
      }
      stats.communitiesDetected = communities.length;
    }

    return stats;
  }
}

interface ChunkDocument {
  id: string;
  sourceKind: ChunkSourceKind;
  content: string;
  mtime: number;
}

async function collectChunkDocuments(vaultPath: string): Promise<ChunkDocument[]> {
  const documents: ChunkDocument[] = [];
  for (const spec of [
    { root: 'raw', sourceKind: 'raw' as const },
    { root: 'wiki/sources', sourceKind: 'wiki-sources' as const },
  ]) {
    for (const relPath of await collectMarkdownFiles(vaultPath, spec.root)) {
      const absPath = join(vaultPath, relPath);
      const raw = await readFile(absPath, 'utf-8');
      const content = parseMarkdownContent(raw);
      const fileStat = await stat(absPath);
      documents.push({
        id: relPath,
        sourceKind: spec.sourceKind,
        content,
        mtime: fileStat.mtimeMs,
      });
    }
  }
  return documents;
}

async function collectMarkdownFiles(vaultPath: string, subdir: string): Promise<string[]> {
  const dirPath = join(vaultPath, subdir);
  const entries = await readdir(dirPath, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const results: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const relPath = `${subdir}/${entry.name}`;
    if (entry.isDirectory()) {
      results.push(...await collectMarkdownFiles(vaultPath, relPath));
    } else if (entry.name.endsWith('.md')) {
      results.push(relPath);
    }
  }
  return results.sort();
}

function parseMarkdownContent(raw: string): string {
  try {
    return matter(raw).content;
  } catch {
    return raw;
  }
}

function extractTags(frontmatter: Record<string, unknown>): string[] {
  const tags = new Set<string>();
  for (const value of [frontmatter.tags, frontmatter.inline_tags]) {
    if (Array.isArray(value)) {
      for (const tag of value) tags.add(String(tag).replace(/^#/, ''));
    } else if (typeof value === 'string') {
      tags.add(value.replace(/^#/, ''));
    }
  }
  return [...tags];
}
