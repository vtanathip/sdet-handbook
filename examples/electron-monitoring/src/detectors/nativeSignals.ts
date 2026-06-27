import { severityFor } from '../freezeBus.js';
import type { Detector, DetectorCtx } from '../detector.js';
import { log } from '../util/logger.js';

// L5 — Electron native unresponsive / crash signals.
// Highest signal, lowest resolution: Chromium fires webContents 'unresponsive' after its own
// internal hang timeout (~tens of seconds) and 'responsive' on recovery; app 'render-process-gone'
// / 'child-process-gone' fire on a hard crash. Listeners live in main and push to a global the
// Node side drains each poll.

interface NativeEvt { kind: string; t: number; details?: unknown }

export class NativeSignals implements Detector {
  readonly name = 'native';
  private timer?: ReturnType<typeof setInterval>;
  private inflight = false;
  private unresponsiveAt?: number;
  constructor(private readonly ctx: DetectorCtx) {}

  async start(): Promise<void> {
    const app = this.ctx.electronApp;
    if (!app) { log('warn', '[L5] unavailable (cdp mode) — skipping native signals'); return; }
    await app.evaluate(({ app: electronApp, webContents }) => {
      const g = globalThis as unknown as { __native?: NativeEvt[]; __nativeWired?: boolean };
      g.__native = g.__native ?? [];
      if (g.__nativeWired) return;
      g.__nativeWired = true;
      const wire = (wc: { on(ev: string, fn: () => void): void }) => {
        wc.on('unresponsive', () => g.__native!.push({ kind: 'unresponsive', t: Date.now() }));
        wc.on('responsive', () => g.__native!.push({ kind: 'responsive', t: Date.now() }));
      };
      for (const wc of webContents.getAllWebContents()) wire(wc);
      electronApp.on('web-contents-created', (_e, wc) => wire(wc));
      electronApp.on('render-process-gone', (_e, _wc, details) =>
        g.__native!.push({ kind: 'render-process-gone', t: Date.now(), details }));
      electronApp.on('child-process-gone', (_e, details) =>
        g.__native!.push({ kind: 'child-process-gone', t: Date.now(), details }));
    });
    this.timer = setInterval(() => { void this.poll(); }, this.ctx.config.metricsIntervalMs);
  }

  private async poll(): Promise<void> {
    const app = this.ctx.electronApp;
    if (!app || this.inflight) return;
    this.inflight = true;
    try {
      const evts = await app.evaluate(() => {
        const g = globalThis as unknown as { __native?: NativeEvt[] };
        const e = g.__native ?? [];
        g.__native = [];
        return e;
      });
      for (const e of evts) this.handle(e);
    } catch {
      /* app closing — ignore */
    } finally {
      this.inflight = false;
    }
  }

  private handle(e: NativeEvt): void {
    if (e.kind === 'unresponsive') { this.unresponsiveAt = e.t; return; }
    if (e.kind === 'responsive') {
      if (this.unresponsiveAt === undefined) return;
      const durationMs = e.t - this.unresponsiveAt;
      this.unresponsiveAt = undefined;
      this.ctx.bus.emit({
        layer: 'native', startIso: new Date(e.t - durationMs).toISOString(), durationMs,
        severity: severityFor(durationMs), detail: { kind: 'unresponsive-bracket' },
      });
      log('warn', `[L5] webContents unresponsive ${durationMs}ms`);
      return;
    }
    // crash
    this.ctx.bus.emit({
      layer: 'native', startIso: new Date(e.t).toISOString(), durationMs: 0,
      severity: 'SEVERE', detail: { kind: e.kind, details: e.details },
    });
    log('error', `[L5] ${e.kind}`);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.poll();
  }
}
