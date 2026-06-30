import assert from 'node:assert/strict';
import { rendererTapSource } from '../../src/detectors/ipcFlood.js';

// The renderer-side IPC fallback (used when there's no main channel): patch ipcRenderer in the page
// and capture every message WITHOUT the app logging anything. Verified here against a stub ipcRenderer
// in plain Node — no Electron — by running the injected source the same way addInitScript would.
export async function run(): Promise<void> {
  // A minimal ipcRenderer stub; the tap reaches it via window.require('electron').
  const stub: Record<string, unknown> & { _listener?: (...a: unknown[]) => unknown } = {
    send() { /* original */ },
    sendSync() { return 'sync-result'; },
    invoke() { return Promise.resolve('reply-value'); },
    on(_ch: string, fn: (...a: unknown[]) => unknown) { stub._listener = fn; },
  };
  const win: Record<string, unknown> = { require: (m: string) => (m === 'electron' ? { ipcRenderer: stub } : {}) };
  (globalThis as unknown as { window: unknown }).window = win;

  // Run the injected IIFE the way the page would (global scope → `window` resolves to our stub world).
  new Function(rendererTapSource(50))();
  assert.equal(win.__ipcRTap, true, 'tap installed when ipcRenderer is reachable');
  assert.notEqual(win.__ipcRUnavailable, true);

  // Exercise every transport — these now go through the patched wrappers.
  (stub.send as (...a: unknown[]) => unknown)('save-doc', { id: 42, body: 'hello' });
  (stub.sendSync as (...a: unknown[]) => unknown)('read-config', 'theme');
  const p = (stub.invoke as (...a: unknown[]) => Promise<unknown>)('load-orders', { page: 1 });
  // an incoming main→renderer message delivered to a registered listener
  (stub.on as (ch: string, fn: (...a: unknown[]) => unknown) => void)('push-update', () => {});
  stub._listener!({ senderId: 1 }, { tick: 7 });

  const first = (win.__ipcRDrain as () => Record<string, unknown>[])();
  const byTransport = (t: string) => first.filter((m) => m.transport === t);
  assert.equal(byTransport('send').filter((m) => m.dir === 'r2m').length, 1, 'send captured (renderer→main)');
  assert.equal(byTransport('sendSync').length, 1, 'sendSync captured');
  assert.equal(byTransport('invoke').length, 1, 'invoke request captured');
  assert.equal(first.filter((m) => m.dir === 'm2r' && m.channel === 'push-update').length, 1, 'incoming main→renderer captured via on()');

  const save = byTransport('send').find((m) => m.channel === 'save-doc')!;
  assert.ok((save.bytes as number) > 0, 'payload byte size captured');
  assert.ok(String(save.preview).includes('hello'), 'truncated preview captured (shapes+previews, not full bodies)');
  assert.deepEqual(save.argTypes, ['object'], 'arg types captured');
  // The KEY: traceability — every renderer→main message carries the app call-site that issued it.
  assert.ok(typeof save.at === 'string' && (save.at as string).includes('@'), 'app call-site captured on the IPC message');

  // The original behaviour is preserved (wrappers call through).
  assert.equal((stub.sendSync as (...a: unknown[]) => unknown)('x'), 'sync-result', 'sendSync still returns the real value');

  // invoke reply lands after the promise resolves, with round-trip latency.
  await p;
  const second = (win.__ipcRDrain as () => Record<string, unknown>[])();
  const reply = second.find((m) => m.transport === 'invoke-reply' && m.channel === 'load-orders');
  assert.ok(reply, 'invoke reply captured');
  assert.ok(typeof reply!.latencyMs === 'number', 'invoke round-trip latency captured');
}
