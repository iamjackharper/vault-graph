import { describe, it, expect } from 'vitest';
import { getEncoding } from 'js-tiktoken';
import { buildChunkEmbeddingText, chunkMarkdown } from '../src/lib/chunker.js';

const encoding = getEncoding('cl100k_base');

describe('chunkMarkdown', () => {
  it('splits long markdown into capped overlapping chunks', () => {
    const content = `# Long Section\n${Array.from({ length: 1200 }, (_, i) => `token${i}`).join(' ')}`;
    const chunks = chunkMarkdown('raw/long.md', content, 'raw', {
      targetTokens: 500,
      overlapTokens: 80,
      mtime: 123,
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(encoding.encode(chunk.text).length).toBeLessThanOrEqual(500);
      expect(chunk.documentId).toBe('raw/long.md');
      expect(chunk.sourceKind).toBe('raw');
      expect(chunk.mtime).toBe(123);
    }
    expect(chunks[1].startToken).toBeLessThan(chunks[0].endToken);
  });

  it('preserves markdown heading paths', () => {
    const chunks = chunkMarkdown(
      'wiki/sources/source.md',
      '# Project\nIntro\n\n## Meeting\nOpenAI discussion details.',
      'wiki-sources',
      { targetTokens: 20, overlapTokens: 5 },
    );

    expect(chunks.map(c => c.headingPath)).toEqual([
      ['Project'],
      ['Project', 'Meeting'],
    ]);
    expect(buildChunkEmbeddingText(chunks[1])).toContain('Project > Meeting');
  });

  it('is deterministic', () => {
    const content = '# Heading\nStable content '.repeat(120);
    const first = chunkMarkdown('raw/a.md', content, 'raw');
    const second = chunkMarkdown('raw/a.md', content, 'raw');
    expect(second).toEqual(first);
  });
});
