import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlWriter } from '../src/util/jsonl.js';

describe('JsonlWriter', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'jsonl-')); });

  it('appends one line per record, valid NDJSON', async () => {
    const w = new JsonlWriter(join(dir, 'out.jsonl'));
    await w.append({ a: 1 });
    await w.append({ b: 'two' });
    await w.close();
    const lines = readFileSync(join(dir, 'out.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ a: 1 });
    expect(JSON.parse(lines[1])).toEqual({ b: 'two' });
  });

  it('serializes concurrent appends safely (in order of await)', async () => {
    const w = new JsonlWriter(join(dir, 'out.jsonl'));
    await Promise.all([w.append({ i: 1 }), w.append({ i: 2 }), w.append({ i: 3 })]);
    await w.close();
    const lines = readFileSync(join(dir, 'out.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(3);
  });
});
