import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Store } from './store.js';
import type { ParsedNode } from './types.js';

type NodeWithRowid = ParsedNode & { rowid: number };

interface LinkSummary {
  nodeId: string;
  title: string;
}

function compactLinks(links: LinkSummary[], limit = 12): LinkSummary[] {
  const seen = new Set<string>();
  const compact: LinkSummary[] = [];
  for (const link of links) {
    if (seen.has(link.nodeId)) continue;
    seen.add(link.nodeId);
    compact.push(link);
    if (compact.length >= limit) break;
  }
  return compact;
}

function readCanonicalMarkdown(vaultPath: string, nodeId: string): string | undefined {
  const vaultRoot = resolve(vaultPath);
  const notePath = resolve(vaultRoot, nodeId);
  if (!notePath.startsWith(`${vaultRoot}/`) && notePath !== vaultRoot) return undefined;
  try {
    return readFileSync(notePath, 'utf-8');
  } catch {
    return undefined;
  }
}

function truncate(content: string, limit: number): string {
  if (content.length <= limit) return content;
  return `${content.slice(0, limit)}\n\n... [truncated, ${content.length} chars total]`;
}

export function buildBriefNodeResult(store: Store, node: NodeWithRowid) {
  return {
    id: node.id,
    title: node.title,
    frontmatter: node.frontmatter,
    outgoingCount: store.countEdgesFrom(node.id),
    incomingCount: store.countEdgesTo(node.id),
    outgoing: compactLinks(store.getEdgeSummariesFrom(node.id)),
    incoming: compactLinks(store.getEdgeSummariesTo(node.id)),
  };
}

export function buildFullNodeResult(
  store: Store,
  node: NodeWithRowid,
  vaultPath: string,
  maxContentLength: number,
) {
  const markdown = readCanonicalMarkdown(vaultPath, node.id);
  const content = markdown ?? node.content;
  return {
    id: node.id,
    title: node.title,
    path: node.id,
    format: 'markdown',
    content: truncate(content, maxContentLength),
    contentSource: markdown ? 'vault-file' : 'index-content',
    frontmatter: node.frontmatter,
    outgoingCount: store.countEdgesFrom(node.id),
    incomingCount: store.countEdgesTo(node.id),
    outgoing: compactLinks(store.getEdgeSummariesFrom(node.id)),
    incoming: compactLinks(store.getEdgeSummariesTo(node.id)),
  };
}
