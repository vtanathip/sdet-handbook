import { severityFor } from '../freezeBus.js';
import type { Detector, DetectorCtx } from '../detector.js';
import { log } from '../util/logger.js';

// L3 — main-process event-loop lag.
// A timer in the Electron main process measures how late it fires vs its 50ms schedule; the delay
// is the time the main event loop was blocked (sync IPC handler, heavy compute, blocking I/O),
// which stalls ALL windows + IPC. We poll the worst lag each interval and reset.
//
// ponytail: implemented with setInterval + Date.now instead of perf_hooks.monitorEventLoopDelay —
// electronApp.evaluate runs the function via eval with no `require` in scope, so node:perf_hooks
// isn't reachable. The timer-lag method measures the same thing with globals only.

const INTERVAL = 50;

export class MainLoopLag implements Detector {
  readonly name = 'main-loop';
  private timer?: ReturnType<typeof setInterval>;
  private inflight = false;
  constructor(private readonly ctx: DetectorCtx) {}

  async start(): Promise<void> {
    const app = this.ctx.electronApp;
    if (!app) { log('warn', '[L3] unavailable (cdp mode) — skipping main-loop lag'); return; }
    await app.evaluate((_electron, interval) => {
      const g = globalThis as typeof globalThis & { __elt?: ReturnType<typeof setInterval>; __eltRead?: () => number };
      if (g.__eltRead) return;
      let last = Date.now();
      let max = 0;
      g.__elt = setInterval(() => {
        const now = Date.now();
        const lag = now - last - interval;
        if (lag > max) max = lag;
        last = now;
      }, interval);
      g.__eltRead = () => { const m = max; max = 0; return m; };
    }, INTERVAL);
    this.timer = setInterval(() => { void this.poll(); }, this.ctx.config.metricsIntervalMs);
  }

  private async poll(): Promise<void> {
    const app = this.ctx.electronApp;
    if (!app || this.inflight) return;
    this.inflight = true;
    try {
      const maxMs = await app.evaluate(() => {
        const g = globalThis as typeof globalThis & { __eltRead?: () => number };
        return g.__eltRead ? g.__eltRead() : 0;
      });
      if (maxMs > this.ctx.config.mainLoopMaxMs) {
        const durationMs = Math.round(maxMs);
        this.ctx.bus.emit({
          layer: 'main-loop',
          startIso: new Date(Date.now() - durationMs).toISOString(),
          durationMs,
          severity: severityFor(durationMs),
          detail: { maxLagMs: durationMs },
        });
        log('warn', `[L3] main event loop blocked ${durationMs}ms`);
      }
    } catch {
      /* app closing — ignore */
    } finally {
      this.inflight = false;
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.poll();
    const app = this.ctx.electronApp;
    if (app) {
      await app.evaluate(() => {
        const g = globalThis as typeof globalThis & { __elt?: ReturnType<typeof setInterval> };
        if (g.__elt) clearInterval(g.__elt);
      }).catch(() => {});
    }
  }
}
