import assert from 'node:assert/strict';

// L3 mechanism (the exact logic mainLoopLag.ts runs in the Electron main process): a timer measures
// how late it fires vs its 50ms schedule; a synchronous block makes the next tick fire late by ~the
// block duration. A 300ms block must show up as >200ms lag.
export async function run(): Promise<void> {
  const interval = 50;
  let last = Date.now();
  let maxLag = 0;
  const timer = setInterval(() => {
    const now = Date.now();
    const lag = now - last - interval;
    if (lag > maxLag) maxLag = lag;
    last = now;
  }, interval);

  await new Promise((r) => setTimeout(r, 120)); // a few clean ticks first
  const t = Date.now();
  while (Date.now() - t < 300) { /* block the loop */ }
  await new Promise((r) => setTimeout(r, 120)); // let the late tick register
  clearInterval(timer);

  assert.ok(maxLag > 200, `timer lag should exceed 200ms after a 300ms block, got ${Math.round(maxLag)}ms`);
}
