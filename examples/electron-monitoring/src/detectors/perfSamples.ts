import { join } from 'node:path';
import type { Detector, DetectorCtx } from '../detector.js';
import { JsonlWriter } from '../util/jsonl.js';

// Client-perf sampling for the build-vs-build sign-off: a ROUTE timeline (every navigation) and a
// JS-HEAP sample per interval. The route timeline lets the reducer attribute every captured event
// (IPC, lag, gaps, network) to the screen that was active — so the comparison is per-route, not just
// whole-app. JS heap (renderer) is the memory metric the perf gate compares between builds.
export class PerfSamples implements Detector {
  readonly name = 'perf-samples';
  private routes: JsonlWriter;
  private heap: JsonlWriter;
  private timer?: ReturnType<typeof setInterval>;
  private inflight = false;
  private lastUrl = '';
  constructor(private readonly ctx: DetectorCtx) {
    this.routes = new JsonlWriter(join(ctx.runDir, 'routes.jsonl'));
    this.heap = new JsonlWriter(join(ctx.runDir, 'heap.jsonl'));
  }

  async start(): Promise<void> {
    // Navigations → the route timeline. framenavigated fires for the main frame on every route change.
    this.ctx.page.on('framenavigated', (frame) => {
      try { if (frame === this.ctx.page.mainFrame()) void this.record(frame.url()); } catch { /* detached */ }
    });
    await this.record(this.ctx.page.url()).catch(() => {});
    this.timer = setInterval(() => { void this.sampleHeap(); }, this.ctx.config.metricsIntervalMs);
  }

  private async record(url: string): Promise<void> {
    if (!url || url === this.lastUrl) return;
    this.lastUrl = url;
    await this.routes.append({ ts: new Date().toISOString(), url });
  }

  private async sampleHeap(): Promise<void> {
    if (this.inflight) return;
    this.inflight = true;
    try {
      // performance.memory is Chromium-only (present in Electron renderers). Bucketed unless launched
      // with --enable-precise-memory-info, which is plenty for a build-to-build delta.
      const r = (await this.ctx.page.evaluate(() => {
        const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
        return { heap: m ? m.usedJSHeapSize : 0, route: location.pathname + location.search + location.hash };
      })) as { heap: number; route: string };
      if (r.heap > 0) await this.heap.append({ ts: new Date().toISOString(), heapMB: Math.round(r.heap / 1048576), route: r.route });
    } catch {
      /* page busy/closed — skip this tick */
    } finally {
      this.inflight = false;
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.sampleHeap();
    await this.routes.close();
    await this.heap.close();
  }
}
