import { severityFor } from '../freezeBus.js';
import type { Detector, DetectorCtx } from '../detector.js';
import type { IpcTiming } from '../mainBridge.js';
import { log } from '../util/logger.js';

// L3 — main-process event-loop lag.
// A timer in the Electron main process measures how late it fires vs its 50ms schedule; the delay
// is the time the main event loop was blocked (sync IPC handler, heavy compute, blocking I/O), which
// stalls ALL windows + IPC. The MainBridge runs the probe via Playwright (source) or the Node
// inspector (cdp+inspect). Idle lag is ~0.
//
// Attribution: we also time every ipcMain handler invocation (the #1 real cause of a blocked main
// loop is a slow handler). When a lag spike fires we blame the slowest handler whose invocation
// window overlaps the spike and accounts for a meaningful fraction of it — so the report says
// "handler 'reconcile-ledger' (invoke) blocked 2961ms" instead of "loop stalled 2961ms". No match
// (a bare compute loop / sync fs call) is itself a signal: the freeze isn't an IPC handler.

export class MainLoopLag implements Detector {
  readonly name = 'main-loop';
  private timer?: ReturnType<typeof setInterval>;
  private inflight = false;
  private timings: IpcTiming[] = [];
  constructor(private readonly ctx: DetectorCtx) {}

  async start(): Promise<void> {
    if (!this.ctx.mainBridge) { log('warn', '[L3] no main-process channel — skipping main-loop lag'); return; }
    await this.ctx.mainBridge.startEventLoopMonitor();
    await this.ctx.mainBridge.startIpcHandlerTimer().catch(() => {});
    this.timer = setInterval(() => { void this.poll(); }, this.ctx.config.metricsIntervalMs);
  }

  private async poll(): Promise<void> {
    if (!this.ctx.mainBridge || this.inflight) return;
    this.inflight = true;
    try {
      // Keep a small rolling buffer of handler timings so a spike can be matched to a recent call.
      this.timings.push(...await this.ctx.mainBridge.drainIpcHandlerTimings().catch(() => []));
      if (this.timings.length > 500) this.timings.splice(0, this.timings.length - 500);

      const maxMs = await this.ctx.mainBridge.readEventLoopLagMs();
      if (maxMs > this.ctx.config.mainLoopMaxMs) {
        const durationMs = Math.round(maxMs);
        const now = Date.now();
        const spikeStart = now - durationMs;
        const floor = Math.min(durationMs * 0.5, this.ctx.config.mainLoopMaxMs);
        const best = this.timings
          .filter((t) => t.ts + t.durationMs >= spikeStart && t.ts <= now && t.durationMs >= floor)
          .sort((a, b) => b.durationMs - a.durationMs)[0];
        const detail: Record<string, unknown> = best
          ? { maxLagMs: durationMs, blockingChannel: best.channel, blockingKind: best.kind, blockingMs: Math.round(best.durationMs) }
          : { maxLagMs: durationMs };
        if (best) this.timings = this.timings.filter((t) => t !== best);
        this.ctx.bus.emit({
          layer: 'main-loop',
          startIso: new Date(spikeStart).toISOString(),
          durationMs,
          severity: severityFor(durationMs),
          detail,
        });
        log('warn', best
          ? `[L3] main loop blocked ${durationMs}ms — handler '${best.channel}' (${best.kind}) ${Math.round(best.durationMs)}ms`
          : `[L3] main event loop blocked ${durationMs}ms`);
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
    await this.ctx.mainBridge?.stopEventLoopMonitor().catch(() => {});
  }
}
