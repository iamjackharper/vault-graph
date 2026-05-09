import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  Embedder,
  truncateToTokens,
} from '../src/lib/embedder.js';

const vector = Array.from({ length: DEFAULT_EMBEDDING_DIMENSIONS }, (_, i) => i / 1000);

describe('Embedder', () => {
  beforeEach(() => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn(async (_url, _init) => ({
      ok: true,
      json: async () => ({ data: [{ embedding: vector }] }),
    })));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('requires OPENAI_API_KEY', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const embedder = new Embedder();
    await expect(embedder.init()).rejects.toThrow('OPENAI_API_KEY is required');
  });

  it('requests text-embedding-3-small and returns a 1536-dimensional embedding', async () => {
    const embedder = new Embedder();
    await embedder.init();
    const embedding = await embedder.embed('Hello world');

    expect(embedding).toBeInstanceOf(Float32Array);
    expect(embedding.length).toBe(DEFAULT_EMBEDDING_DIMENSIONS);
    expect(fetch).toHaveBeenCalledOnce();
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: DEFAULT_EMBEDDING_MODEL,
      input: 'Hello world',
    });
  });

  it('surfaces OpenAI API errors clearly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ error: { message: 'bad key' } }),
    })));
    const embedder = new Embedder();
    await embedder.init();

    await expect(embedder.embed('Hello')).rejects.toThrow(
      'OpenAI embeddings request failed: bad key'
    );
  });

  it('builds embedding text from title, tags, and body capped to 256 tokens', () => {
    const text = Embedder.buildEmbeddingText(
      'Widget Theory',
      ['concept', 'framework'],
      Array.from({ length: 500 }, (_, i) => `detail${i}`).join(' '),
    );

    expect(text).toContain('Widget Theory');
    expect(text).toContain('concept');
    expect(text).not.toContain('detail499');
    expect(tokenCount(text)).toBeLessThanOrEqual(256);
  });

  it('allows explicit token caps for tests and future tuning', () => {
    const text = truncateToTokens('alpha beta gamma delta epsilon', 3);
    expect(tokenCount(text)).toBeLessThanOrEqual(3);
  });
});

function tokenCount(text: string): number {
  // Reuse production behavior through truncateToTokens: increasing cap until
  // unchanged is unnecessary here; this helper only checks exact short caps.
  let low = 1;
  let high = 512;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (truncateToTokens(text, mid) === text) high = mid;
    else low = mid + 1;
  }
  return low;
}
