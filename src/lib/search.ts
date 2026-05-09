import type { Store } from './store.js';
import type { Embedder } from './embedder.js';
import type { ChunkSearchResult, ChunkSourceKind, SearchResult } from './types.js';

export class Search {
  constructor(
    private store: Store,
    private embedder: Embedder,
  ) {}

  async semantic(query: string, limit = 20): Promise<SearchResult[]> {
    const queryEmbedding = await this.embedder.embed(query);
    return this.store.searchVector(queryEmbedding, limit);
  }

  fulltext(query: string, limit = 20): SearchResult[] {
    return this.store.searchFullText(query).slice(0, limit);
  }

  async chunks(
    query: string,
    options: { limit?: number; sourceKind?: ChunkSourceKind; documentId?: string } = {},
  ): Promise<ChunkSearchResult[]> {
    const queryEmbedding = await this.embedder.embed(query);
    return this.store.searchChunksVector(queryEmbedding, options);
  }
}
