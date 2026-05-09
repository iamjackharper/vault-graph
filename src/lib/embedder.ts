import { getEncoding } from 'js-tiktoken';

export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;
export const DEFAULT_EMBEDDING_MAX_TOKENS = 256;

interface OpenAIEmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
  error?: { message?: string };
}

export class Embedder {
  private apiKey: string | undefined;
  private model: string;
  private maxTokens: number;

  constructor(options: { apiKey?: string; model?: string; maxTokens?: number } = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    this.model = options.model ?? process.env.KG_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
    this.maxTokens = options.maxTokens
      ?? parsePositiveInt(process.env.KG_EMBEDDING_MAX_TOKENS)
      ?? DEFAULT_EMBEDDING_MAX_TOKENS;
  }

  async init(): Promise<void> {
    if (!this.apiKey) {
      throw new Error(
        'OPENAI_API_KEY is required for semantic indexing/search with OpenAI embeddings.'
      );
    }
  }

  async embed(text: string): Promise<Float32Array> {
    if (!this.apiKey) {
      throw new Error('Embedder not initialized. Call init() first.');
    }

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    });

    const json = await response.json() as OpenAIEmbeddingResponse;
    if (!response.ok) {
      const message = json.error?.message ?? `${response.status} ${response.statusText}`;
      throw new Error(`OpenAI embeddings request failed: ${message}`);
    }

    const values = json.data?.[0]?.embedding;
    if (!Array.isArray(values)) {
      throw new Error('OpenAI embeddings response did not include an embedding.');
    }
    if (values.length !== DEFAULT_EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Expected ${DEFAULT_EMBEDDING_DIMENSIONS} embedding dimensions, got ${values.length}.`
      );
    }
    return new Float32Array(values);
  }

  async dispose(): Promise<void> {
    // OpenAI embeddings are stateless; no local model resources to release.
  }

  buildEmbeddingText(title: string, tags: string[], content: string): string {
    return Embedder.buildEmbeddingText(title, tags, content, this.maxTokens);
  }

  static buildEmbeddingText(
    title: string,
    tags: string[],
    content: string,
    maxTokens = parsePositiveInt(process.env.KG_EMBEDDING_MAX_TOKENS)
      ?? DEFAULT_EMBEDDING_MAX_TOKENS,
  ): string {
    const parts = [title];
    if (tags.length > 0) {
      parts.push(tags.join(', '));
    }
    if (content) {
      parts.push(content);
    }
    return truncateToTokens(parts.join('\n'), maxTokens);
  }
}

export function truncateToTokens(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return '';
  const encoding = getEncoding('cl100k_base');
  const tokens = encoding.encode(text);
  if (tokens.length <= maxTokens) return text;
  return encoding.decode(tokens.slice(0, maxTokens));
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value;
}
