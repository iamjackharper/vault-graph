# vault-graph

`vault-graph` turns an Obsidian vault into a local intelligence layer: a derived document graph for navigation, semantic search for discovery, full-text search for exact recall, and chunk retrieval for evidence buried in long sources.

The vault remains the canonical source of truth. Markdown files, wikilinks, and frontmatter stay human-readable and editable; SQLite, vectors, communities, and chunk indexes are derived infrastructure that can be rebuilt at any time.

## What it does

Parses `wiki/**/*.md` notes from an Obsidian vault into an untyped graph (files = nodes, wiki links = edges), indexes them into SQLite with vector embeddings and full-text search, and exposes operations via CLI. An MCP server is also available for compatible clients. `inbox/` and root-level markdown files are intentionally excluded. `raw/**/*.md` stays out of the graph but is indexed as semantic chunks.

**Search:** Document semantic search via OpenAI `text-embedding-3-small`, full-text keyword search via FTS5, and chunk search over `raw/**/*.md` plus `wiki/sources/**/*.md`.

**Traverse:** Find paths between nodes, shared connections, N-hop neighborhoods, local subgraphs.

**Analyze:** Community detection (Louvain), bridge nodes (betweenness centrality), central nodes (PageRank).

## Install

```bash
git clone https://github.com/your-org/vault-graph.git
cd vault-graph
npm install
npm run build
npm link
```

Set your vault path:

```bash
export KG_VAULT_PATH=/path/to/your/obsidian/vault
export OPENAI_API_KEY=sk-...
```

You can also use `OBSIDIAN_VAULT_PATH` instead of `KG_VAULT_PATH`. `vault-graph` automatically loads `.env` from the current directory and `~/.hermes/.env` without overriding variables already exported in the shell.

Optionally set the data directory (defaults to `~/.local/share/vault-graph`):

```bash
export KG_DATA_DIR=/path/to/data
export KG_EMBEDDING_MODEL=text-embedding-3-small
export KG_EMBEDDING_MAX_TOKENS=256
```

## CLI usage

Index the curated `wiki/` notes in your vault:

```bash
vault-graph index
vault-graph watch
```

Then query:

```bash
# Look up a node (brief mode — metadata + connections)
vault-graph node "Alice"

# Full content + edge context
vault-graph node "Cheshire Cat" --full

# Semantic search
vault-graph search "why Alice follows the White Rabbit"

# Full-text keyword search (SQLite FTS5 query language)
vault-graph search '"White Rabbit" OR "Mad Hatter"' --fulltext

# Chunk-level passage search over raw files and wiki sources
vault-graph chunks "what the Caterpillar says about identity"
vault-graph chunks "Queen of Hearts" --source raw
vault-graph chunks "tea party logic" --source wiki-sources

# Find paths between two nodes
vault-graph paths "Alice" "Queen of Hearts"

# Shared connections
vault-graph common "Alice" "White Queen"

# Local neighborhood
vault-graph neighbors "Cheshire Cat" --depth 2

# Subgraph extraction
vault-graph subgraph "Tea Party" --depth 1

# Community detection
vault-graph communities

# Bridge nodes (connectors between clusters)
vault-graph bridges --limit 10

# Central nodes (PageRank)
vault-graph central --limit 10
```

All commands return JSON. Names are fuzzy-matched (title, aliases, substring). You can also pass full node IDs (file paths).

`vault-graph index` is incremental, but it is not automatic. It scans the vault when invoked, skips unchanged files by `mtime`, re-embeds only changed wiki notes and changed chunks, and refreshes graph analytics when graph nodes changed.

`vault-graph watch` keeps a process running and calls the same incremental indexer after relevant Markdown changes in `wiki/**/*.md` and `raw/**/*.md`. It debounces batches of file events and runs another index pass if changes arrive during an active index.

For a VPS setup, install it as a background service:

```bash
scripts/install-watch-service.sh
systemctl status vault-graph-watch.service --no-pager -l
```

The service loads the configured environment file, falls back from `KG_VAULT_PATH` to `OBSIDIAN_VAULT_PATH`, and restarts automatically if the watcher exits.
Pass `VAULT_GRAPH_VPS_SSH_TARGET`, and optionally `VAULT_GRAPH_VPS_SSH_KEY`, `VAULT_GRAPH_VPS_REPO_DIR`, `VAULT_GRAPH_REMOTE_ENV_FILE`, `VAULT_GRAPH_REMOTE_DATA_DIR`, and `VAULT_GRAPH_REMOTE_VAULT_PATH` to match your host.

## Search vs chunks

`vault-graph search` is document-level retrieval over canonical `wiki/**/*.md` notes. It returns graph nodes: people, projects, concepts, and source notes. Use it to answer: "Which notes should I inspect?"

`vault-graph search ... --fulltext` is keyword retrieval over the full content of wiki notes. It uses SQLite FTS5 query syntax, not regex syntax. Use operators like `OR`, quoted phrases like `"White Rabbit"`, and other FTS5 query forms. Do not use regex alternation such as `foo|bar`.

`vault-graph chunks` is passage-level retrieval over `raw/**/*.md` and `wiki/sources/**/*.md`. It returns excerpts with document IDs and heading paths. Use it to answer: "Where is this actually said?" Chunks are retrieval evidence attached to source documents; they are not graph nodes.

## Agent skill

The repo includes `skills/vault-research/SKILL.md`, a CLI-first workflow for agents that need to answer questions, investigate claims, trace relationships, or synthesize evidence from the vault. It teaches when to use document search, full-text search, chunk retrieval, and graph traversal.

## How it works

- **Parser:** Walks only `wiki/**/*.md`, extracts YAML frontmatter (via gray-matter), wiki links, inline `#tags`, and enclosing paragraphs as edge context. Handles malformed YAML gracefully.
- **Store:** SQLite with sqlite-vec for document and chunk vector search, plus FTS5 for full-text document search. Single file database.
- **Embedder:** OpenAI `text-embedding-3-small`, 1536-dimensional embeddings. Embedding input is title + tags + note body capped to 256 `cl100k_base` tokens. FTS still indexes the full wiki note content.
- **Chunks:** `raw/**/*.md` and `wiki/sources/**/*.md` are chunked into 500-token passages with 80-token overlap. Chunks keep document ID and heading path, but never become graph nodes.
- **Graph:** graphology for in-memory graph algorithms — Louvain community detection, betweenness centrality, PageRank (with degree centrality fallback for disconnected graphs), BFS traversal, all-simple-paths via DFS.
- **Indexing:** Incremental by default when `vault-graph index` or `vault-graph watch` runs — tracks file mtimes, only reprocesses changed files and changed chunks. Community detection re-runs on the full graph when graph nodes changed. Use `--force` for a full rebuild.

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

## Credits

`vault-graph` is a fork of [`obra/knowledge-graph`](https://github.com/obra/knowledge-graph) and was adapted for a canonical Obsidian vault workflow with document-level graph indexing, OpenAI embeddings, and chunk retrieval.

## License

MIT
