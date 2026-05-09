import { getEncoding } from 'js-tiktoken';
import type { ChunkSourceKind, ParsedChunk } from './types.js';

export interface ChunkOptions {
  targetTokens?: number;
  overlapTokens?: number;
  mtime?: number;
}

const DEFAULT_TARGET_TOKENS = 500;
const DEFAULT_OVERLAP_TOKENS = 80;

interface Section {
  headingPath: string[];
  text: string;
}

const encoding = getEncoding('cl100k_base');

export function chunkMarkdown(
  documentId: string,
  content: string,
  sourceKind: ChunkSourceKind,
  options: ChunkOptions = {},
): ParsedChunk[] {
  const targetTokens = options.targetTokens ?? DEFAULT_TARGET_TOKENS;
  const overlapTokens = Math.min(options.overlapTokens ?? DEFAULT_OVERLAP_TOKENS, targetTokens - 1);
  const mtime = options.mtime ?? 0;
  const chunks: ParsedChunk[] = [];
  let globalIndex = 0;
  let tokenCursor = 0;

  for (const section of splitIntoSections(content)) {
    const tokens = encoding.encode(section.text);
    if (tokens.length === 0) continue;

    let start = 0;
    while (start < tokens.length) {
      const end = Math.min(start + targetTokens, tokens.length);
      const text = encoding.decode(tokens.slice(start, end)).trim();
      if (text) {
        chunks.push({
          id: `${documentId}#chunk-${globalIndex}`,
          documentId,
          sourceKind,
          headingPath: section.headingPath,
          chunkIndex: globalIndex,
          startToken: tokenCursor + start,
          endToken: tokenCursor + end,
          text,
          mtime,
        });
        globalIndex++;
      }
      if (end >= tokens.length) break;
      start = Math.max(0, end - overlapTokens);
    }
    tokenCursor += tokens.length;
  }

  return chunks;
}

export function buildChunkEmbeddingText(chunk: ParsedChunk): string {
  const heading = chunk.headingPath.join(' > ');
  return heading ? `${heading}\n${chunk.text}` : chunk.text;
}

function splitIntoSections(markdown: string): Section[] {
  const sections: Section[] = [];
  const headingStack: string[] = [];
  let currentLines: string[] = [];
  let currentPath: string[] = [];

  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      headingStack.length = level - 1;
      headingStack[level - 1] = heading[2].trim();
      currentPath = headingStack.filter(Boolean);
      currentLines.push(line);
      continue;
    }
    currentLines.push(line);
  }
  flush();

  return sections.length > 0 ? sections : [{ headingPath: [], text: markdown }];

  function flush(): void {
    const text = currentLines.join('\n').trim();
    if (text) {
      sections.push({ headingPath: currentPath, text });
    }
    currentLines = [];
  }
}
