import { join } from 'node:path';
import { severityFor } from '../freezeBus.js';
import type { Detector, DetectorCtx } from '../detector.js';
import { JsonlWriter } from '../util/jsonl.js';
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
  const cores = navigator.hardwareConcurrency; // constant — capacity reframes severity (2-core CI box)
  let last = performance.now();
  let maxGap = 0;
  // Full-capture: every jank gap ≥ JANK_FLOOR (one missed ~3-frame budget) since the last read, so the
  // report can show per-step UI responsiveness — not just the single worst freeze.
  // ponytail: 50ms floor keeps the stream to real jank; drop it via the harness if you want every frame.
  const JANK_FLOOR = 50;
  let gaps: { gapMs: number; at: number }[] = [];
  const tick = () => {
    const now = performance.now();
    // Ignore gaps while the window is hidden: background tabs/windows throttle timers, which would
    // otherwise look like a multi-second freeze. A real user-visible freeze happens while visible.
    if (document.visibilityState !== 'hidden') {
      const gap = now - last;
      if (gap > maxGap) maxGap = gap;
      if (gap >= JANK_FLOOR && gaps.length < 4000) gaps.push({ gapMs: Math.round(gap), at: Date.now() });
    }
    last = now;
  };
  setInterval(tick, 50);
  const raf = () => { tick(); requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
  // Read the cheap contextual envelope at recovery: WHICH screen froze + was it visible + capacity.
  // All free reads — no new observers/wrappers.
  w.__hbRead = () => {
    const m = maxGap; const g = gaps;
    maxGap = 0; gaps = [];
    return {
      maxGap: m,
      gaps: g,
      sinceLast: performance.now() - last,
      route: location.pathname + location.search + location.hash,
      visibility: document.visibilityState,
      cores,
    };
  };
}

export class RendererHeartbeat implements Detector {
  readonly name = 'renderer-heartbeat';
  private timer?: ReturnType<typeof setInterval>;
  private inflight = false;
  private out: JsonlWriter;
  constructor(private readonly ctx: DetectorCtx) {
    this.out = new JsonlWriter(join(ctx.runDir, 'heartbeat.jsonl'));
  }

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
        () => (window as unknown as { __hbRead?: () => HbSnapshot }).__hbRead?.() ?? { maxGap: 0 },
      )) as HbSnapshot;
      // Full-capture: stream every jank gap (with route) so per-step UI responsiveness is traceable.
      if (this.ctx.config.captureAll && r.gaps?.length) {
        for (const g of r.gaps) await this.out.append({ ts: new Date(g.at).toISOString(), gapMs: g.gapMs, route: r.route, visibility: r.visibility });
      }
      emitIfFrozen(r, this.ctx);
    } catch {
      /* page closed / navigating — ignore */
    } finally {
      this.inflight = false;
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.poll(); // final drain catches a freeze that ended just before teardown
    await this.out.close();
  }
}

interface HbSnapshot { maxGap: number; gaps?: { gapMs: number; at: number }[]; sinceLast?: number; route?: string; visibility?: string; cores?: number }

function emitIfFrozen(snap: HbSnapshot, ctx: DetectorCtx): void {
  if (snap.maxGap <= ctx.config.heartbeatMs) return;
  const durationMs = Math.round(snap.maxGap);
  ctx.bus.emit({
    layer: 'renderer-heartbeat',
    startIso: new Date(Date.now() - durationMs).toISOString(),
    durationMs,
    severity: severityFor(durationMs),
    detail: { gapMs: durationMs, thresholdMs: ctx.config.heartbeatMs, route: snap.route, visibility: snap.visibility, cores: snap.cores },
  });
  log('warn', `[L1] renderer UI thread blocked ${durationMs}ms${snap.route ? ` on ${snap.route}` : ''}`);
}
