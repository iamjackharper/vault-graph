import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

describe('sqlite-vec compatibility', () => {
  it('can insert and query 1536-dimensional OpenAI embeddings', () => {
    const db = new Database(':memory:');
    sqliteVec.load(db);

    db.exec('CREATE VIRTUAL TABLE test_vec USING vec0(embedding float[1536])');

    const insert = db.prepare('INSERT INTO test_vec(rowid, embedding) VALUES (?, ?)');
    const embedding = new Float32Array(1536).fill(0.1);
    insert.run(BigInt(1), Buffer.from(embedding.buffer));

    const results = db.prepare(
      'SELECT rowid, distance FROM test_vec WHERE embedding MATCH ? ORDER BY distance LIMIT 1'
    ).all(Buffer.from(embedding.buffer));

    expect(results).toHaveLength(1);
    expect((results[0] as any).rowid).toBe(1);
    expect((results[0] as any).distance).toBeCloseTo(0, 4);

    db.close();
  });
});
