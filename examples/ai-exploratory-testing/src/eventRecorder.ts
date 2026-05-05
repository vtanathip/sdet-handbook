import type { JsonlWriter } from './util/jsonl.js';

const KEEP = new Set([
  'session.usage_info',
  'session.compaction_start',
  'session.compaction_complete',
  'session.task_complete',
  'session.idle',
  'session.truncation',
  'session.shutdown',
  'session.error',
  'assistant.message',
  'assistant.usage',
  'tool.call_start',
  'tool.call_complete',
  'tool.execution_complete',
]);

export interface Subscribable {
  on(handler: (event: { type: string; [k: string]: unknown }) => void): () => void;
}

export function attachEventRecorder(session: Subscribable, out: JsonlWriter): () => void {
  return session.on((event) => {
    if (!KEEP.has(event.type)) return;
    const withTs = { ts: new Date().toISOString(), ...event };
    out.append(withTs).catch((err) => console.error('jsonl append failed', err));
  });
}
