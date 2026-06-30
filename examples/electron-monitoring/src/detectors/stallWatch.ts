import { join } from 'node:path';
import type { CDPSession } from 'playwright';
import { severityFor } from '../freezeBus.js';
import type { Detector, DetectorCtx } from '../detector.js';
import { JsonlWriter } from '../util/jsonl.js';
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

interface Tracked {
  url: string; start: number; resolvedAt?: number; flagged?: boolean;
  method?: string; resourceType?: string;
  initiator?: string;   // 'loadCart @ app.js:212:9' — YOUR code that started it (the call site to fix)
  errorText?: string;   // net::ERR_* when it failed (DNS, timeout, blocked) — the actual failure
  blockedReason?: string;
  status?: number;      // HTTP status (full-capture stream)
  mimeType?: string;
  bytes?: number;       // encodedDataLength on finish
  streamed?: boolean;   // already written to network.jsonl
}

// Compact "who started this request" string from the CDP initiator: prefer the top script frame.
function initiatorOf(ini?: {
  type?: string; url?: string; lineNumber?: number;
  stack?: { callFrames?: Array<{ functionName?: string; url?: string; lineNumber?: number; columnNumber?: number }> };
}): string {
  if (!ini) return '';
  const f = ini.stack?.callFrames?.[0];
  if (f) return `${f.functionName || '(anonymous)'} @ ${f.url}:${(f.lineNumber ?? 0) + 1}:${(f.columnNumber ?? 0) + 1}`;
  if (ini.url) return `${ini.type} @ ${ini.url}${ini.lineNumber != null ? ':' + (ini.lineNumber + 1) : ''}`;
  return ini.type ?? '';
}

export class StallWatch implements Detector {
  readonly name = 'stall';
  private cdp?: CDPSession;
  private timer?: ReturnType<typeof setInterval>;
  private readonly inflight = new Map<string, Tracked>();
  private out: JsonlWriter;
  constructor(private readonly ctx: DetectorCtx) {
    this.out = new JsonlWriter(join(ctx.runDir, 'network.jsonl'));
  }

  async start(): Promise<void> {
    try {
      this.cdp = await this.ctx.page.context().newCDPSession(this.ctx.page);
      await this.cdp.send('Network.enable');
      this.cdp.on('Network.requestWillBeSent', (e: {
        requestId: string; type?: string; request: { url: string; method?: string };
        initiator?: Parameters<typeof initiatorOf>[0];
      }) => {
        this.inflight.set(e.requestId, {
          url: e.request.url, start: Date.now(),
          method: e.request.method, resourceType: e.type, initiator: initiatorOf(e.initiator),
        });
      });
      // Full-capture: status + mime for every response (not just stalls).
      this.cdp.on('Network.responseReceived', (e: { requestId: string; response?: { status?: number; mimeType?: string } }) => {
        const t = this.inflight.get(e.requestId);
        if (t) { t.status = e.response?.status; t.mimeType = e.response?.mimeType; }
      });
      this.cdp.on('Network.loadingFinished', (e: { requestId: string; encodedDataLength?: number }) => {
        const t = this.inflight.get(e.requestId);
        if (t) { t.resolvedAt = Date.now(); t.bytes = e.encodedDataLength; void this.streamRequest(t); }
      });
      // A request that "resolved" by FAILING isn't slow — the errorText is the root cause (bad DNS,
      // server down, blocked by CSP). Capture it.
      this.cdp.on('Network.loadingFailed', (e: { requestId: string; errorText?: string; blockedReason?: string }) => {
        const t = this.inflight.get(e.requestId);
        if (t) { t.resolvedAt = Date.now(); t.errorText = e.errorText; t.blockedReason = e.blockedReason; void this.streamRequest(t); }
      });
      this.timer = setInterval(() => this.poll(), 1000);
    } catch (err) {
      log('warn', '[L8] stall watch unavailable for this target', err);
    }
  }

  // Stream every completed/failed request so per-step network timing is traceable.
  private async streamRequest(t: Tracked): Promise<void> {
    if (!this.ctx.config.captureAll || t.streamed) return;
    t.streamed = true;
    await this.out.append({
      ts: new Date(t.start).toISOString(), url: t.url, method: t.method, resourceType: t.resourceType,
      status: t.status, mimeType: t.mimeType, bytes: t.bytes,
      durationMs: Math.round((t.resolvedAt ?? Date.now()) - t.start),
      initiator: t.initiator, errorText: t.errorText, blockedReason: t.blockedReason,
    });
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
      // Flush still-in-flight requests to the stream so nothing is lost at teardown.
      if (!t.streamed) await this.streamRequest(t);
      const age = (t.resolvedAt ?? now) - t.start;
      if (age <= this.ctx.config.stallMs) continue; // only report genuinely-stuck operations
      const resolved = t.resolvedAt != null;
      this.ctx.bus.emit({
        layer: 'stall',
        startIso: new Date(t.start).toISOString(),
        durationMs: age,
        // never-resolved OR resolved-by-failing is the worst; a merely-slow success scales by duration.
        severity: !resolved || t.errorText ? 'SEVERE' : severityFor(age),
        detail: {
          kind: 'request', target: t.url, ageMs: age, resolved,
          method: t.method, resourceType: t.resourceType, initiator: t.initiator,
          errorText: t.errorText, blockedReason: t.blockedReason,
        },
      });
    }
    await this.cdp?.detach().catch(() => {});
    await this.out.close();
  }
}
