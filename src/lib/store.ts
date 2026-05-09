import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import type {
  ChunkSearchResult,
  ChunkSourceKind,
  ParsedChunk,
  ParsedEdge,
  ParsedNode,
  SearchResult,
} from './types.js';

const EMBEDDING_DIMENSIONS = 1536;

export class Store {
  db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    sqliteVec.load(this.db);
    this.createSchema();
  }

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT,
        frontmatter TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        context TEXT NOT NULL DEFAULT ''
      );

      CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);

      CREATE TABLE IF NOT EXISTS communities (
        id INTEGER PRIMARY KEY,
        label TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        node_ids TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS sync (
        path TEXT PRIMARY KEY,
        mtime INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        heading_path TEXT NOT NULL DEFAULT '[]',
        chunk_index INTEGER NOT NULL,
        start_token INTEGER NOT NULL,
        end_token INTEGER NOT NULL,
        text TEXT NOT NULL,
        mtime INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
      CREATE INDEX IF NOT EXISTS idx_chunks_source_kind ON chunks(source_kind);

      CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts
        USING fts5(title, content, content='nodes', content_rowid='rowid');

      CREATE VIRTUAL TABLE IF NOT EXISTS nodes_vec
        USING vec0(embedding float[1536]);

      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec
        USING vec0(embedding float[1536]);
    `);
    this.ensureVectorSchema('nodes_vec');
    this.ensureVectorSchema('chunks_vec');
  }

  private ensureVectorSchema(tableName: string): void {
    const row = this.db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name = ?"
    ).get(tableName) as { sql: string } | undefined;

    if (row && !row.sql.includes(`float[${EMBEDDING_DIMENSIONS}]`)) {
      this.db.prepare(`DROP TABLE ${tableName}`).run();
      this.db.prepare(
        `CREATE VIRTUAL TABLE ${tableName} USING vec0(embedding float[${EMBEDDING_DIMENSIONS}])`
      ).run();
    }
  }

  upsertNode(node: ParsedNode): void {
    // FTS5 content-sync tables require manual delete-before-reinsert.
    // We must fetch the ACTUAL old values for the FTS5 delete command.
    const existing = this.db.prepare(
      'SELECT rowid, title, content FROM nodes WHERE id = ?'
    ).get(node.id) as { rowid: number; title: string; content: string } | undefined;

    if (existing) {
      this.db.prepare(
        "INSERT INTO nodes_fts(nodes_fts, rowid, title, content) VALUES('delete', ?, ?, ?)"
      ).run(existing.rowid, existing.title, existing.content);
    }

    this.db.prepare(`
      INSERT INTO nodes (id, title, content, frontmatter)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        frontmatter = excluded.frontmatter
    `).run(node.id, node.title, node.content, JSON.stringify(node.frontmatter));

    const row = this.db.prepare(
      'SELECT rowid FROM nodes WHERE id = ?'
    ).get(node.id) as { rowid: number };

    this.db.prepare(
      'INSERT INTO nodes_fts(rowid, title, content) VALUES(?, ?, ?)'
    ).run(row.rowid, node.title, node.content);
  }

  getNode(id: string): (ParsedNode & { rowid: number }) | undefined {
    const row = this.db.prepare(
      'SELECT rowid, id, title, content, frontmatter FROM nodes WHERE id = ?'
    ).get(id) as any;
    if (!row) return undefined;
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      frontmatter: JSON.parse(row.frontmatter),
      rowid: row.rowid,
    };
  }

  allNodeIds(): string[] {
    return this.db.prepare('SELECT id FROM nodes').all().map((r: any) => r.id);
  }

  insertEdge(edge: ParsedEdge): void {
    this.db.prepare(
      'INSERT INTO edges (source_id, target_id, context) VALUES (?, ?, ?)'
    ).run(edge.sourceId, edge.targetId, edge.context);
  }

  getEdgesFrom(nodeId: string): Array<ParsedEdge & { id: number }> {
    return this.db.prepare(
      'SELECT id, source_id, target_id, context FROM edges WHERE source_id = ?'
    ).all(nodeId).map((r: any) => ({
      id: r.id,
      sourceId: r.source_id,
      targetId: r.target_id,
      context: r.context,
    }));
  }

  getEdgesTo(nodeId: string): Array<ParsedEdge & { id: number }> {
    return this.db.prepare(
      'SELECT id, source_id, target_id, context FROM edges WHERE target_id = ?'
    ).all(nodeId).map((r: any) => ({
      id: r.id,
      sourceId: r.source_id,
      targetId: r.target_id,
      context: r.context,
    }));
  }

  countEdgesFrom(nodeId: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM edges WHERE source_id = ?'
    ).get(nodeId) as { cnt: number };
    return row.cnt;
  }

  countEdgesTo(nodeId: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM edges WHERE target_id = ?'
    ).get(nodeId) as { cnt: number };
    return row.cnt;
  }

  getEdgeSummariesFrom(nodeId: string): Array<{ nodeId: string; title: string }> {
    return this.db.prepare(`
      SELECT DISTINCT e.target_id, n.title
      FROM edges e
      LEFT JOIN nodes n ON n.id = e.target_id
      WHERE e.source_id = ?
    `).all(nodeId).map((r: any) => ({
      nodeId: r.target_id,
      title: r.title ?? r.target_id,
    }));
  }

  getEdgeSummariesTo(nodeId: string): Array<{ nodeId: string; title: string }> {
    return this.db.prepare(`
      SELECT DISTINCT e.source_id, n.title
      FROM edges e
      LEFT JOIN nodes n ON n.id = e.source_id
      WHERE e.target_id = ?
    `).all(nodeId).map((r: any) => ({
      nodeId: r.source_id,
      title: r.title ?? r.source_id,
    }));
  }

  deleteNode(id: string): void {
    // FTS5 delete requires actual old values, not empty strings
    const row = this.db.prepare(
      'SELECT rowid, title, content FROM nodes WHERE id = ?'
    ).get(id) as { rowid: number; title: string; content: string } | undefined;

    if (row) {
      this.db.prepare(
        "INSERT INTO nodes_fts(nodes_fts, rowid, title, content) VALUES('delete', ?, ?, ?)"
      ).run(row.rowid, row.title, row.content);
      // sqlite-vec requires BigInt rowids via better-sqlite3
      this.db.prepare('DELETE FROM nodes_vec WHERE rowid = ?').run(BigInt(row.rowid));
    }

    this.db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM edges WHERE source_id = ? OR target_id = ?').run(id, id);
    this.db.prepare('DELETE FROM sync WHERE path = ?').run(id);
  }

  deleteAllEdgesFrom(nodeId: string): void {
    this.db.prepare('DELETE FROM edges WHERE source_id = ?').run(nodeId);
  }

  searchFullText(query: string): SearchResult[] {
    return this.db.prepare(`
      SELECT n.id, n.title, rank,
        snippet(nodes_fts, 1, '>>>', '<<<', '...', 40) as excerpt
      FROM nodes_fts f
      JOIN nodes n ON n.rowid = f.rowid
      WHERE nodes_fts MATCH ?
      ORDER BY rank
      LIMIT 20
    `).all(query).map((r: any) => ({
      nodeId: r.id,
      title: r.title,
      score: -r.rank,
      excerpt: r.excerpt ?? '',
    }));
  }

  upsertEmbedding(nodeId: string, embedding: Float32Array): void {
    const node = this.getNode(nodeId);
    if (!node) return;
    // sqlite-vec requires BigInt rowids via better-sqlite3
    this.db.prepare('DELETE FROM nodes_vec WHERE rowid = ?').run(BigInt(node.rowid));
    this.db.prepare(
      'INSERT INTO nodes_vec(rowid, embedding) VALUES (?, ?)'
    ).run(BigInt(node.rowid), Buffer.from(embedding.buffer));
  }

  searchVector(embedding: Float32Array, limit = 20): SearchResult[] {
    return this.db.prepare(`
      SELECT v.rowid, v.distance, n.id, n.title, n.content
      FROM nodes_vec v
      JOIN nodes n ON n.rowid = v.rowid
      WHERE embedding MATCH ? AND k = ?
      ORDER BY distance
    `).all(Buffer.from(embedding.buffer), limit).map((r: any) => ({
      nodeId: r.id,
      title: r.title,
      score: 1 - r.distance,
      excerpt: firstParagraph(r.content ?? '', 200),
    }));
  }

  deleteChunksForDocument(documentId: string): void {
    const rows = this.db.prepare(
      'SELECT rowid FROM chunks WHERE document_id = ?'
    ).all(documentId) as Array<{ rowid: number }>;
    for (const row of rows) {
      this.db.prepare('DELETE FROM chunks_vec WHERE rowid = ?').run(BigInt(row.rowid));
    }
    this.db.prepare('DELETE FROM chunks WHERE document_id = ?').run(documentId);
  }

  clearChunks(): void {
    this.db.prepare('DELETE FROM chunks_vec').run();
    this.db.prepare('DELETE FROM chunks').run();
  }

  upsertChunk(chunk: ParsedChunk): void {
    const existing = this.db.prepare(
      'SELECT rowid FROM chunks WHERE id = ?'
    ).get(chunk.id) as { rowid: number } | undefined;
    if (existing) {
      this.db.prepare('DELETE FROM chunks_vec WHERE rowid = ?').run(BigInt(existing.rowid));
    }

    this.db.prepare(`
      INSERT INTO chunks (
        id, document_id, source_kind, heading_path, chunk_index,
        start_token, end_token, text, mtime, indexed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        document_id = excluded.document_id,
        source_kind = excluded.source_kind,
        heading_path = excluded.heading_path,
        chunk_index = excluded.chunk_index,
        start_token = excluded.start_token,
        end_token = excluded.end_token,
        text = excluded.text,
        mtime = excluded.mtime,
        indexed_at = excluded.indexed_at
    `).run(
      chunk.id,
      chunk.documentId,
      chunk.sourceKind,
      JSON.stringify(chunk.headingPath),
      chunk.chunkIndex,
      chunk.startToken,
      chunk.endToken,
      chunk.text,
      chunk.mtime,
      Date.now(),
    );
  }

  upsertChunkEmbedding(chunkId: string, embedding: Float32Array): void {
    const chunk = this.db.prepare(
      'SELECT rowid FROM chunks WHERE id = ?'
    ).get(chunkId) as { rowid: number } | undefined;
    if (!chunk) return;
    this.db.prepare('DELETE FROM chunks_vec WHERE rowid = ?').run(BigInt(chunk.rowid));
    this.db.prepare(
      'INSERT INTO chunks_vec(rowid, embedding) VALUES (?, ?)'
    ).run(BigInt(chunk.rowid), Buffer.from(embedding.buffer));
  }

  searchChunksVector(
    embedding: Float32Array,
    options: { limit?: number; sourceKind?: ChunkSourceKind; documentId?: string } = {},
  ): ChunkSearchResult[] {
    const limit = options.limit ?? 20;
    const k = options.sourceKind || options.documentId ? Math.max(limit * 20, limit) : limit;
    const filters: string[] = [];
    const params: unknown[] = [Buffer.from(embedding.buffer), k];
    if (options.sourceKind) {
      filters.push('c.source_kind = ?');
      params.push(options.sourceKind);
    }
    if (options.documentId) {
      filters.push('c.document_id = ?');
      params.push(options.documentId);
    }
    const where = filters.length > 0 ? `AND ${filters.join(' AND ')}` : '';
    return this.db.prepare(`
      SELECT v.distance, c.id, c.document_id, c.source_kind, c.heading_path,
        c.chunk_index, c.text
      FROM chunks_vec v
      JOIN chunks c ON c.rowid = v.rowid
      WHERE embedding MATCH ? AND k = ?
      ${where}
      ORDER BY distance
      LIMIT ${limit}
    `).all(...params).map((r: any) => ({
      chunkId: r.id,
      documentId: r.document_id,
      sourceKind: r.source_kind,
      headingPath: JSON.parse(r.heading_path),
      chunkIndex: r.chunk_index,
      score: 1 - r.distance,
      text: r.text,
    }));
  }

  getChunkDocumentIds(): Set<string> {
    return new Set(
      this.db.prepare('SELECT DISTINCT document_id FROM chunks').all().map((r: any) => r.document_id)
    );
  }

  getChunkDocumentMtime(documentId: string): number | undefined {
    const row = this.db.prepare(
      'SELECT MAX(mtime) as mtime FROM chunks WHERE document_id = ?'
    ).get(documentId) as { mtime: number | null } | undefined;
    return row?.mtime ?? undefined;
  }

  upsertSync(path: string, mtime: number): void {
    this.db.prepare(`
      INSERT INTO sync (path, mtime, indexed_at) VALUES (?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET mtime = excluded.mtime, indexed_at = excluded.indexed_at
    `).run(path, mtime, Date.now());
  }

  getSyncMtime(path: string): number | undefined {
    const row = this.db.prepare(
      'SELECT mtime FROM sync WHERE path = ?'
    ).get(path) as { mtime: number } | undefined;
    return row?.mtime;
  }

  getAllSyncPaths(): Set<string> {
    return new Set(
      this.db.prepare('SELECT path FROM sync').all().map((r: any) => r.path)
    );
  }

  upsertCommunity(community: { id: number; label: string; summary: string; nodeIds: string[] }): void {
    this.db.prepare(`
      INSERT INTO communities (id, label, summary, node_ids) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        label = excluded.label,
        summary = excluded.summary,
        node_ids = excluded.node_ids
    `).run(community.id, community.label, community.summary, JSON.stringify(community.nodeIds));
  }

  clearCommunities(): void {
    this.db.prepare('DELETE FROM communities').run();
  }

  getAllCommunities(): Array<{ id: number; label: string; summary: string; nodeIds: string[] }> {
    return this.db.prepare('SELECT * FROM communities').all().map((r: any) => ({
      id: r.id,
      label: r.label,
      summary: r.summary,
      nodeIds: JSON.parse(r.node_ids),
    }));
  }

  close(): void {
    this.db.close();
  }
}

function firstParagraph(content: string, maxLen: number): string {
  const para = content.split(/\n\n+/).find(p => p.trim().length > 0 && !p.startsWith('#'));
  if (!para) return '';
  const trimmed = para.trim();
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) + '...' : trimmed;
}
