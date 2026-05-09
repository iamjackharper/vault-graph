# vault-graph

Query and traverse the curated `wiki/` section of an Obsidian vault as a knowledge graph. Semantic search uses OpenAI embeddings; graph traversal and storage stay local.

## What it does

Parses `wiki/**/*.md` notes from an Obsidian vault into an untyped graph (files = nodes, wiki links = edges), indexes them into SQLite with vector embeddings and full-text search, and exposes operations via CLI and MCP server. `inbox/` and root-level markdown files are intentionally excluded. `raw/**/*.md` stays out of the graph but is indexed as semantic chunks.

**Search:** Document semantic search via OpenAI `text-embedding-3-small`, full-text keyword search via FTS5, and chunk search over `raw/**/*.md` plus `wiki/sources/**/*.md`.

**Traverse:** Find paths between nodes, shared connections, N-hop neighborhoods, local subgraphs.

**Analyze:** Community detection (Louvain), bridge nodes (betweenness centrality), central nodes (PageRank).

## Install

```bash
git clone https://github.com/iamjackharper/vault-graph.git
cd vault-graph
npm install
```

Set your vault path:

```bash
export KG_VAULT_PATH=/path/to/your/obsidian/vault
export OPENAI_API_KEY=sk-...
```

Optionally set the data directory (defaults to `~/.local/share/vault-graph`):

```bash
export KG_DATA_DIR=/path/to/data
export KG_EMBEDDING_MODEL=text-embedding-3-small
export KG_EMBEDDING_MAX_TOKENS=256
```

## CLI usage

Build the CLI and index the curated `wiki/` notes in your vault:

```bash
npm run build
vault-graph index
```

Then query:

```bash
# Look up a node (brief mode — metadata + connections)
vault-graph node "Alice Smith"

# Full content + edge context
vault-graph node "Alice Smith" --full

# Semantic search
vault-graph search "distributed systems framework"

# Full-text keyword search
vault-graph search "distributed systems" --fulltext

# Chunk-level passage search over raw files and wiki sources
vault-graph chunks "distributed systems architecture"
vault-graph chunks "distributed systems" --source raw
vault-graph chunks "distributed systems" --document raw/2026/foo.md

# Find paths between two nodes
vault-graph paths "Alice Smith" "Widget Theory"

# Shared connections
vault-graph common "Alice Smith" "Bob Jones"

# Local neighborhood
vault-graph neighbors "Alice Smith" --depth 2

# Subgraph extraction
vault-graph subgraph "Widget Theory" --depth 1

# Community detection
vault-graph communities

# Bridge nodes (connectors between clusters)
vault-graph bridges --limit 10

# Central nodes (PageRank)
vault-graph central --limit 10
```

All commands return JSON. Names are fuzzy-matched (title, aliases, substring). You can also pass full node IDs (file paths).

## How it works

- **Parser:** Walks only `wiki/**/*.md`, extracts YAML frontmatter (via gray-matter), wiki links, inline `#tags`, and enclosing paragraphs as edge context. Handles malformed YAML gracefully.
- **Store:** SQLite with sqlite-vec for document and chunk vector search, plus FTS5 for full-text document search. Single file database.
- **Embedder:** OpenAI `text-embedding-3-small`, 1536-dimensional embeddings. Embedding input is title + tags + note body capped to 256 `cl100k_base` tokens. FTS still indexes the full wiki note content.
- **Chunks:** `raw/**/*.md` and `wiki/sources/**/*.md` are chunked into 500-token passages with 80-token overlap. Chunks keep document ID and heading path, but never become graph nodes.
- **Graph:** graphology for in-memory graph algorithms — Louvain community detection, betweenness centrality, PageRank (with degree centrality fallback for disconnected graphs), BFS traversal, all-simple-paths via DFS.
- **Indexing:** Incremental by default — tracks file mtimes, only reprocesses changed files and changed chunks. Community detection re-runs on the full graph. Use `--force` for a full rebuild.

## Tech stack

| Role | Package |
|------|---------|
| Graph algorithms | graphology |
| Persistence | better-sqlite3 |
| Vector search | sqlite-vec |
| Full-text search | SQLite FTS5 |
| Embeddings | OpenAI embeddings API + js-tiktoken |
| MCP server | @modelcontextprotocol/sdk |
| Tests | vitest |

## Known quirks

- **sqlite-vec requires BigInt rowids** when used with better-sqlite3.
- **sqlite-vec KNN queries** use `WHERE embedding MATCH ? AND k = ?`, not `LIMIT`.
- **PageRank** may fail to converge on large graphs with many disconnected components. Falls back to degree centrality automatically.
- **Wiki link resolution** uses Obsidian's "shortest unique path" algorithm. Ambiguous links (same filename in multiple directories) resolve to the first match with a warning.

## License

MIT
