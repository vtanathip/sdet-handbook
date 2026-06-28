import { severityFor } from '../freezeBus.js';
import type { Detector, DetectorCtx } from '../detector.js';
import type { NativeEvt } from '../mainBridge.js';
import { log } from '../util/logger.js';

// L5 — Electron native unresponsive / crash signals.
// Highest signal, lowest resolution: Chromium fires webContents 'unresponsive' after its own
// internal hang timeout (~tens of seconds) and 'responsive' on recovery; app 'render-process-gone'
// / 'child-process-gone' fire on a hard crash. Listeners live in main (wired via the MainBridge) and
// push to a global the harness drains each poll.

export class NativeSignals implements Detector {
  readonly name = 'native';
  private timer?: ReturnType<typeof setInterval>;
  private inflight = false;
  // Keyed by webContents id so two windows can be unresponsive at once without clobbering each other
  // (the old single field paired the wrong responsive→unresponsive when >1 window hung).
  private unresponsive = new Map<number, NativeEvt>();
  constructor(private readonly ctx: DetectorCtx) {}

  async start(): Promise<void> {
    if (!this.ctx.mainBridge) { log('warn', '[L5] no main-process channel — skipping native signals'); return; }
    await this.ctx.mainBridge.wireNativeListeners();
    this.timer = setInterval(() => { void this.poll(); }, this.ctx.config.metricsIntervalMs);
  }

  private async poll(): Promise<void> {
    if (!this.ctx.mainBridge || this.inflight) return;
    this.inflight = true;
    try {
      for (const e of await this.ctx.mainBridge.drainNative()) this.handle(e);
    } catch {
      /* app closing — ignore */
    } finally {
      this.inflight = false;
    }
  }

  private handle(e: NativeEvt): void {
    const key = e.wcId ?? -1; // -1 = unknown id (older Electron / source channel single-window)
    if (e.kind === 'unresponsive') { this.unresponsive.set(key, e); return; }
    if (e.kind === 'responsive') {
      const u = this.unresponsive.get(key);
      if (!u) return;
      const durationMs = e.t - u.t;
      this.unresponsive.delete(key);
      this.ctx.bus.emit({
        layer: 'native', startIso: new Date(u.t).toISOString(), durationMs,
        severity: severityFor(durationMs),
        detail: { kind: 'unresponsive-bracket', wcId: u.wcId, url: u.url, title: u.title, wcType: u.wcType },
      });
      log('warn', `[L5] ${u.title || u.url || 'window'} unresponsive ${durationMs}ms`);
      return;
    }
    this.ctx.bus.emit({
      layer: 'native', startIso: new Date(e.t).toISOString(), durationMs: 0,
      severity: 'SEVERE',
      detail: { kind: e.kind, details: e.details, wcId: e.wcId, url: e.url, title: e.title, wcType: e.wcType },
    });
    log('error', `[L5] ${e.kind}${e.title ? ` — ${e.title}` : ''}`);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.poll();
  }
}
