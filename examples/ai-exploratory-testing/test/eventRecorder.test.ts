import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attachEventRecorder } from '../src/eventRecorder.js';
import { JsonlWriter } from '../src/util/jsonl.js';

interface EvtHandler { (e: { type: string; [k: string]: unknown }): void; }

function fakeSession() {
  const handlers: EvtHandler[] = [];
  return {
    on(h: EvtHandler) { handlers.push(h); return () => {}; },
    emit(e: { type: string; [k: string]: unknown }) { handlers.forEach((h) => h(e)); },
  };
}

describe('attachEventRecorder', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'evt-')); });

  it('records session.usage_info, compaction, task_complete', async () => {
    const s = fakeSession();
    const path = join(dir, 'events.jsonl');
    const w = new JsonlWriter(path);
    attachEventRecorder(s, w);
    s.emit({ type: 'session.usage_info', tokenLimit: 1, currentTokens: 1, isInitial: true });
    s.emit({ type: 'session.task_complete', summary: 'x' });
    s.emit({ type: 'session.compaction_start' });
    await new Promise((r) => setTimeout(r, 20));
    await w.close();
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).type).toBe('session.usage_info');
  });

  it('skips noisy internal events', async () => {
    const s = fakeSession();
    const path = join(dir, 'events.jsonl');
    const w = new JsonlWriter(path);
    attachEventRecorder(s, w);
    s.emit({ type: 'session.heartbeat' });
    s.emit({ type: 'something.internal' });
    await new Promise((r) => setTimeout(r, 20));
    await w.close();
    const raw = readFileSync(path, 'utf8');
    expect(raw).toBe('');
  });
});
