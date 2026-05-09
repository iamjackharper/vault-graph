import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseVault } from '../src/lib/parser.js';

async function makeVault(): Promise<string> {
  const vault = await mkdtemp(join(tmpdir(), 'kg-vault-'));
  await mkdir(join(vault, 'wiki', 'People'), { recursive: true });
  await mkdir(join(vault, 'wiki', 'Concepts'), { recursive: true });
  await mkdir(join(vault, 'raw'), { recursive: true });
  await mkdir(join(vault, 'inbox'), { recursive: true });

  await writeFile(join(vault, 'README.md'), '# Root file\n[[wiki/People/Alice Smith]]');
  await writeFile(join(vault, 'raw', 'transcript.md'), '# Raw\n[[wiki/People/Alice Smith]]');
  await writeFile(join(vault, 'inbox', 'idea.md'), '# Inbox\n[[wiki/People/Alice Smith]]');
  await writeFile(join(vault, 'wiki', 'People', 'Alice Smith.md'), `---
title: Alice Smith
type: person
aliases:
  - A. Smith
---
Alice studies [[Widget Theory]] and references [[raw/transcript]] plus [[README]].
`);
  await writeFile(join(vault, 'wiki', 'People', 'Bob Jones.md'), `---
title: Bob Jones
---
Bob works on #research and #published notes.
`);
  await writeFile(join(vault, 'wiki', 'Concepts', 'Widget Theory.md'), `---
title: Widget Theory
---
A framework linked from Alice.
`);
  await writeFile(join(vault, 'wiki', 'no-title.md'), 'No frontmatter title.');
  return vault;
}

describe('parseVault', () => {
  it('indexes only wiki markdown files', async () => {
    const { nodes } = await parseVault(await makeVault());
    const ids = nodes.map(n => n.id);
    expect(ids).toEqual(expect.arrayContaining([
      'wiki/People/Alice Smith.md',
      'wiki/People/Bob Jones.md',
      'wiki/Concepts/Widget Theory.md',
      'wiki/no-title.md',
    ]));
    expect(ids.every(id => id.startsWith('wiki/'))).toBe(true);
    expect(ids).not.toContain('README.md');
    expect(ids).not.toContain('raw/transcript.md');
    expect(ids).not.toContain('inbox/idea.md');
  });

  it('parses frontmatter correctly', async () => {
    const { nodes } = await parseVault(await makeVault());
    const alice = nodes.find(n => n.id === 'wiki/People/Alice Smith.md')!;
    expect(alice.title).toBe('Alice Smith');
    expect(alice.frontmatter.type).toBe('person');
    expect(alice.frontmatter.aliases).toContain('A. Smith');
  });

  it('falls back to filename when no title in frontmatter', async () => {
    const { nodes } = await parseVault(await makeVault());
    const noTitle = nodes.find(n => n.id === 'wiki/no-title.md')!;
    expect(noTitle.title).toBe('no-title');
  });

  it('extracts resolved wiki-only edges with context', async () => {
    const { edges } = await parseVault(await makeVault());
    const aliceToWidget = edges.find(
      e => e.sourceId === 'wiki/People/Alice Smith.md'
        && e.targetId === 'wiki/Concepts/Widget Theory.md'
    );
    expect(aliceToWidget).toBeDefined();
    expect(aliceToWidget!.context).toContain('Widget Theory');
  });

  it('does not create stub edges for excluded or unresolved targets', async () => {
    const { edges, stubIds } = await parseVault(await makeVault());
    expect(edges.some(e => e.targetId.includes('_stub'))).toBe(false);
    expect(edges.some(e => e.targetId.includes('raw/transcript'))).toBe(false);
    expect(edges.some(e => e.targetId.includes('README'))).toBe(false);
    expect(stubIds.size).toBe(0);
  });

  it('extracts inline tags', async () => {
    const { nodes } = await parseVault(await makeVault());
    const bob = nodes.find(n => n.id === 'wiki/People/Bob Jones.md')!;
    expect(bob.frontmatter.inline_tags).toContain('research');
    expect(bob.frontmatter.inline_tags).toContain('published');
  });
});
