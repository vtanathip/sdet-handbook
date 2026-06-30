import assert from 'node:assert/strict';
import { storageTapSource } from '../../src/detectors/storageDisk.js';

// localStorage/sessionStorage write tracking, traced to the app call-site — verified against a stub
// Storage in plain Node (no Electron), run the way addInitScript would inject it.
export function run(): void {
  // A Storage whose methods live on Storage.prototype, so the tap's prototype patch intercepts them.
  function Storage(this: { _d: Record<string, string> }) { this._d = {}; }
  Storage.prototype.setItem = function (this: { _d: Record<string, string> }, k: string, v: string) { this._d[k] = String(v); };
  Storage.prototype.getItem = function (this: { _d: Record<string, string> }, k: string) { return this._d[k] ?? null; };
  Storage.prototype.removeItem = function (this: { _d: Record<string, string> }, k: string) { delete this._d[k]; };
  Storage.prototype.clear = function (this: { _d: Record<string, string> }) { this._d = {}; };
  Storage.prototype.key = function (this: { _d: Record<string, string> }, i: number) { return Object.keys(this._d)[i]; };
  Object.defineProperty(Storage.prototype, 'length', { get(this: { _d: Record<string, string> }) { return Object.keys(this._d).length; } });
  const g = globalThis as unknown as { Storage: unknown; window: unknown };
  g.Storage = Storage;
  const local = new (Storage as unknown as new () => unknown)();
  const session = new (Storage as unknown as new () => unknown)();
  const win: Record<string, unknown> = { localStorage: local, sessionStorage: session };
  g.window = win;

  new Function(storageTapSource(40))();
  assert.equal(win.__lsTap, true, 'storage tap installed');

  (local as { setItem(k: string, v: string): void }).setItem('cart', JSON.stringify({ items: 3, total: 19.99 }));
  (session as { setItem(k: string, v: string): void }).setItem('csrf', 'token-abc');
  (local as { setItem(k: string, v: string): void }).setItem('cart', JSON.stringify({ items: 4 })); // update
  (local as { removeItem(k: string): void }).removeItem('stale');

  const ops = (win.__lsDrain as () => Record<string, unknown>[])();
  const sets = ops.filter((o) => o.op === 'set');
  assert.equal(sets.length, 3, 'three setItem calls captured');
  assert.equal(ops.filter((o) => o.op === 'remove').length, 1, 'removeItem captured');

  const cart = sets.find((o) => o.key === 'cart')!;
  assert.equal(cart.area, 'local', 'localStorage vs sessionStorage distinguished by `this`');
  assert.equal(sets.find((o) => o.key === 'csrf')!.area, 'session', 'sessionStorage write tagged session');
  assert.ok((cart.valueBytes as number) > 0, 'value byte size captured');
  assert.ok(String(cart.preview).includes('items'), 'truncated value preview captured');
  // The KEY: traceability — each write carries the app call-site that wrote it.
  assert.ok(typeof cart.at === 'string' && (cart.at as string).includes('@'), 'app call-site captured on the storage write');

  // Snapshot of what the app left in storage.
  const snap = (win.__lsSnapshot as () => { local: { key: string }[]; session: { key: string }[] })();
  assert.ok(snap.local.some((e) => e.key === 'cart'), 'final snapshot lists the keys left in storage');
  assert.ok(snap.session.some((e) => e.key === 'csrf'), 'snapshot covers sessionStorage too');
}
