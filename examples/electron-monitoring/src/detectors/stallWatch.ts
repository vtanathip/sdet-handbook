import type { CDPSession } from 'playwright';
import { severityFor } from '../freezeBus.js';
import type { Detector, DetectorCtx } from '../detector.js';
import { log } from '../util/logger.js';

// L8 — async-but-idle stalls (the "spinner that never resolves" class).
// The other layers all assume a thread/loop is BLOCKED; the most common user-perceived freeze is a
// request/operation that never completes while the loop keeps turning and CPU is idle. We watch the
// renderer's CDP Network domain and flag any request in-flight longer than `stallMs`. Works in every
// mode (renderer-level, no main process needed). Each stalled request is reported once at teardown:
// SEVERE if it never resolved, MODERATE-by-duration if it was just slow.
//
// (IPC-reply latency — invoke() that never resolves — is a natural extension but needs wrapping
// ipcMain.handle, which only catches handlers registered after attach; left out for now.)

interface Tracked { url: string; start: number; resolvedAt?: number; flagged?: boolean }

export class StallWatch implements Detector {
  readonly name = 'stall';
  private cdp?: CDPSession;
  private timer?: ReturnType<typeof setInterval>;
  private readonly inflight = new Map<string, Tracked>();
  constructor(private readonly ctx: DetectorCtx) {}

  async start(): Promise<void> {
    try {
      this.cdp = await this.ctx.page.context().newCDPSession(this.ctx.page);
      await this.cdp.send('Network.enable');
      this.cdp.on('Network.requestWillBeSent', (e: { requestId: string; request: { url: string } }) => {
        this.inflight.set(e.requestId, { url: e.request.url, start: Date.now() });
      });
      const resolve = (e: { requestId: string }) => {
        const t = this.inflight.get(e.requestId);
        if (t) t.resolvedAt = Date.now();
      };
      this.cdp.on('Network.loadingFinished', resolve);
      this.cdp.on('Network.loadingFailed', resolve);
      this.timer = setInterval(() => this.poll(), 1000);
    } catch (err) {
      log('warn', '[L8] stall watch unavailable for this target', err);
    }
  }

  private poll(): void {
    const now = Date.now();
    for (const t of this.inflight.values()) {
      if (!t.resolvedAt && !t.flagged && now - t.start > this.ctx.config.stallMs) {
        t.flagged = true;
        log('warn', `[L8] request stuck >${Math.round((now - t.start) / 1000)}s: ${t.url.slice(0, 100)}`);
      }
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    const now = Date.now();
    for (const t of this.inflight.values()) {
      const age = (t.resolvedAt ?? now) - t.start;
      if (age <= this.ctx.config.stallMs) continue; // only report genuinely-stuck operations
      const resolved = t.resolvedAt != null;
      this.ctx.bus.emit({
        layer: 'stall',
        startIso: new Date(t.start).toISOString(),
        durationMs: age,
        severity: resolved ? severityFor(age) : 'SEVERE', // never-resolved is always worst
        detail: { kind: 'request', target: t.url, ageMs: age, resolved },
      });
    }
    await this.cdp?.detach().catch(() => {});
  }
}
