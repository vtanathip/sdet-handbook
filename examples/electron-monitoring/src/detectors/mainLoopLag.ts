import { severityFor } from '../freezeBus.js';
import type { Detector, DetectorCtx } from '../detector.js';
import { log } from '../util/logger.js';

// L3 — main-process event-loop lag.
// A timer in the Electron main process measures how late it fires vs its 50ms schedule; the delay
// is the time the main event loop was blocked (sync IPC handler, heavy compute, blocking I/O), which
// stalls ALL windows + IPC. The MainBridge runs the probe via Playwright (source) or the Node
// inspector (cdp+inspect). Idle lag is ~0.

export class MainLoopLag implements Detector {
  readonly name = 'main-loop';
  private timer?: ReturnType<typeof setInterval>;
  private inflight = false;
  constructor(private readonly ctx: DetectorCtx) {}

  async start(): Promise<void> {
    if (!this.ctx.mainBridge) { log('warn', '[L3] no main-process channel — skipping main-loop lag'); return; }
    await this.ctx.mainBridge.startEventLoopMonitor();
    this.timer = setInterval(() => { void this.poll(); }, this.ctx.config.metricsIntervalMs);
  }

  private async poll(): Promise<void> {
    if (!this.ctx.mainBridge || this.inflight) return;
    this.inflight = true;
    try {
      const maxMs = await this.ctx.mainBridge.readEventLoopLagMs();
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
    await this.ctx.mainBridge?.stopEventLoopMonitor().catch(() => {});
  }
}
