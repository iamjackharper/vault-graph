---
name: vault-research
description: Use when researching an Obsidian vault with vault-graph: answer questions, investigate claims, trace relationships, find evidence, synthesize source passages, or explore themes across notes.
---

# Vault Research

Use this workflow when a question requires evidence from an Obsidian vault indexed by `vault-graph`.

The Markdown vault is the source of truth. `vault-graph` is a derived index for retrieval and graph navigation. Do not treat the SQLite/vector index as canonical knowledge, and do not edit it directly.

## Available CLI

Use the `vault-graph` command:

```bash
vault-graph index
vault-graph search "query"
vault-graph search '"exact phrase" OR keyword' --fulltext
vault-graph chunks "query"
vault-graph node "Name" --full
vault-graph neighbors "Name" --depth 2
vault-graph paths "Name A" "Name B"
vault-graph common "Name A" "Name B"
vault-graph communities
vault-graph bridges --limit 10
vault-graph central --limit 10
```

All commands return JSON.

## Search Modes

`vault-graph search` and `vault-graph chunks` are intentionally separate.

Use `vault-graph search` to find canonical document nodes in the graph. It searches `wiki/**/*.md` at document level and returns whole notes such as people, projects, concepts, and source notes. Use it to answer: "Which notes should I inspect?"

```bash
vault-graph search "why Alice follows the White Rabbit"
```

Use `vault-graph search --fulltext` for exact terms, names, phrases, and boolean keyword queries inside full wiki notes. This uses SQLite FTS5 query syntax, not regex syntax. Use `OR` and quoted phrases; do not use `foo|bar`.

```bash
vault-graph search '"White Rabbit" OR "Mad Hatter"' --fulltext
```

Use `vault-graph chunks` to find specific passages inside long source documents. It searches `raw/**/*.md` and `wiki/sources/**/*.md` at passage level and returns excerpts with document IDs and heading paths. Use it to answer: "Where is this actually said?"

```bash
vault-graph chunks "what the Caterpillar says about identity"
vault-graph chunks "Queen of Hearts" --source raw
vault-graph chunks "tea party logic" --source wiki-sources
```

Do not treat chunk results as graph nodes. Chunks are retrieval evidence attached to source documents; the graph remains navigable at the note level.

## Research Workflow

1. Decompose the question into entities, relationships, and evidence needed.

Example: "Does the Cheshire Cat help Alice understand Wonderland?"

Entities: Alice, Cheshire Cat, Wonderland.

Relationship: guidance, interpretation, or explanation.

Evidence needed: notes or source passages showing advice, interpretation, or outcomes.

2. Find candidate notes with document search.

Start with semantic search, then use full-text search for exact names and phrases:

```bash
vault-graph search "guidance in Wonderland"
vault-graph search '"Cheshire Cat" OR Alice' --fulltext
```

3. Read canonical notes.

Use `node --full` for the best candidate notes. Do not infer from titles or graph edges alone.

```bash
vault-graph node "Cheshire Cat" --full
vault-graph node "Alice" --full
```

4. Retrieve source passages with chunk search.

Use `chunks` when the evidence likely lives in raw notes, transcripts, imports, or long source notes. Chunk results are the best place to find precise quotations or detailed evidence, but they should be tied back to their `documentId`.

```bash
vault-graph chunks "Cheshire Cat advice to Alice"
```

5. Explore relationships.

Use graph operations to understand how notes connect, then read the relevant notes:

```bash
vault-graph paths "Alice" "Cheshire Cat"
vault-graph common "Alice" "Wonderland"
vault-graph neighbors "Cheshire Cat" --depth 2
```

6. Synthesize with provenance.

Report the answer with:

- Verdict: supported, contradicted, partially supported, or insufficient evidence.
- Evidence: specific notes and source passages used.
- Reasoning: how the evidence supports the answer.
- Caveats: missing sources, weak links, ambiguous attribution, or uncertainty.

## Graph Interpretation Rules

- A graph path is a lead, not proof. Always read the notes or chunks behind important nodes.
- `common` is useful for shared context, but shared context is not itself causality.
- `communities` shows broad themes, not precise evidence.
- `bridges` and `central` identify structurally important notes; use them for exploration, not as final evidence.
- Absence of a path can be informative, but only after checking semantic search, full-text search, and chunk retrieval.

## When Editing The Vault

If you create or update Markdown notes as part of the research, write to the vault first, then refresh the derived index:

```bash
vault-graph index
```

Never write canonical knowledge directly into the `vault-graph` database.
