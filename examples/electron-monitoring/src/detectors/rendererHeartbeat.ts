import { severityFor } from '../freezeBus.js';
import type { Detector, DetectorCtx } from '../detector.js';
import { log } from '../util/logger.js';

// L1 — renderer UI-thread heartbeat.
// A ticker (setInterval + rAF) runs in the renderer and records the largest gap between
// its own ticks. When the renderer main thread is blocked, ticks stop; on recovery one
// tick shows a gap ≈ the freeze duration. The Node side polls and reads that gap. Truth is
// the *injected-timestamp gap read after recovery* — a page.evaluate cannot run while the
// thread is frozen, so we never rely on the poll succeeding mid-freeze.

/** Pure gap detection (what the in-browser ticker does, expressed over a tick series). */
export function findGaps(ticks: number[], thresholdMs: number): { gapMs: number; atMs: number }[] {
  const out: { gapMs: number; atMs: number }[] = [];
  for (let i = 1; i < ticks.length; i++) {
    const gap = ticks[i] - ticks[i - 1];
    if (gap > thresholdMs) out.push({ gapMs: gap, atMs: ticks[i] });
  }
  return out;
}

// Runs IN the renderer. Self-guarded so addInitScript + evaluate can both call it.
function installHeartbeat(): void {
  const w = window as unknown as { __hbInstalled?: boolean; __hbRead?: () => unknown };
  if (w.__hbInstalled) return;
  w.__hbInstalled = true;
  let last = performance.now();
  let maxGap = 0;
  const tick = () => {
    const now = performance.now();
    // Ignore gaps while the window is hidden: background tabs/windows throttle timers, which would
    // otherwise look like a multi-second freeze. A real user-visible freeze happens while visible.
    if (document.visibilityState !== 'hidden') {
      const gap = now - last;
      if (gap > maxGap) maxGap = gap;
    }
    last = now;
  };
  setInterval(tick, 50);
  const raf = () => { tick(); requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
  w.__hbRead = () => {
    const m = maxGap;
    maxGap = 0;
    return { maxGap: m, sinceLast: performance.now() - last };
  };
}

export class RendererHeartbeat implements Detector {
  readonly name = 'renderer-heartbeat';
  private timer?: ReturnType<typeof setInterval>;
  private inflight = false;
  constructor(private readonly ctx: DetectorCtx) {}

  async start(): Promise<void> {
    await this.ctx.page.addInitScript(installHeartbeat);
    await this.ctx.page.evaluate(installHeartbeat).catch(() => {});
    this.timer = setInterval(() => { void this.poll(); }, this.ctx.config.metricsIntervalMs);
  }

  private async poll(): Promise<void> {
    if (this.inflight) return; // a prior evaluate is still queued behind a frozen renderer
    this.inflight = true;
    try {
      const r = (await this.ctx.page.evaluate(
        () => (window as unknown as { __hbRead?: () => { maxGap: number } }).__hbRead?.() ?? { maxGap: 0 },
      )) as { maxGap: number };
      emitIfFrozen(r.maxGap, this.ctx);
    } catch {
      /* page closed / navigating — ignore */
    } finally {
      this.inflight = false;
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.poll(); // final drain catches a freeze that ended just before teardown
  }
}

function emitIfFrozen(maxGap: number, ctx: DetectorCtx): void {
  if (maxGap <= ctx.config.heartbeatMs) return;
  const durationMs = Math.round(maxGap);
  ctx.bus.emit({
    layer: 'renderer-heartbeat',
    startIso: new Date(Date.now() - durationMs).toISOString(),
    durationMs,
    severity: severityFor(durationMs),
    detail: { gapMs: durationMs, thresholdMs: ctx.config.heartbeatMs },
  });
  log('warn', `[L1] renderer UI thread blocked ${durationMs}ms`);
}
