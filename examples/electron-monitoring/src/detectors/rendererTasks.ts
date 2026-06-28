import { join } from 'node:path';
import { severityFor } from '../freezeBus.js';
import type { Detector, DetectorCtx } from '../detector.js';
import { JsonlWriter } from '../util/jsonl.js';
import { log } from '../util/logger.js';

// L2 — fine-grained renderer attribution.
// PerformanceObserver for `longtask` (≥50ms, universal) AND `long-animation-frame` (LoAF,
// Chromium ≥123) which adds blockingDuration + per-script attribution (sourceURL, function,
// char position). Every task ≥50ms is logged to renderer-tasks.jsonl; tasks ≥ heartbeat
// threshold are promoted to freeze events. Falls back to longtask-only on older Electron.

interface DrainedScript {
  sourceURL: string; functionName: string; charPos: number; duration: number;
  invoker?: string;       // 'BUTTON#renderInvoice.onclick', 'Window.setTimeout' — the real call site
  invokerType?: string;   // 'event-listener' | 'user-callback' | 'resolve-promise' | …
  forcedLayoutMs?: number; // forcedStyleAndLayoutDuration — layout-thrashing signal
  pauseMs?: number;        // pauseDuration — sync-blocking (alert / sync XHR / sendSync)
}
interface DrainedTask {
  kind: 'longtask' | 'loaf';
  time: number; // epoch ms (performance.timeOrigin + startTime)
  duration: number;
  blockingDuration?: number;
  // LoAF frame-phase split: where did the time go — JS vs style/layout/paint?
  workMs?: number;
  renderMs?: number;
  styleLayoutMs?: number;
  scripts?: DrainedScript[];
}

function installTaskObservers(): void {
  const w = window as unknown as {
    __tasksInstalled?: boolean;
    __tasks?: DrainedTask[];
    __loafSupported?: boolean;
    __drainTasks?: () => DrainedTask[];
  };
  if (w.__tasksInstalled) return;
  w.__tasksInstalled = true;
  w.__tasks = [];
  w.__loafSupported = false;
  const push = (t: DrainedTask) => w.__tasks!.push(t);

  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        push({ kind: 'longtask', time: performance.timeOrigin + e.startTime, duration: e.duration });
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch { /* longtask unsupported (very old) */ }

  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as Array<{
        startTime: number; duration: number; blockingDuration: number;
        renderStart?: number; styleAndLayoutStart?: number;
        scripts?: Array<{
          sourceURL: string; sourceFunctionName: string; sourceCharPosition: number; duration: number;
          invoker?: string; invokerType?: string; forcedStyleAndLayoutDuration?: number; pauseDuration?: number;
        }>;
      }>) {
        // Split the frame into where the time went: work (JS) vs render vs style/layout.
        const end = e.startTime + e.duration;
        const workMs = e.renderStart ? e.renderStart - e.startTime : e.duration;
        const renderMs = e.renderStart ? end - e.renderStart : 0;
        const styleLayoutMs = e.styleAndLayoutStart ? end - e.styleAndLayoutStart : 0;
        push({
          kind: 'loaf',
          time: performance.timeOrigin + e.startTime,
          duration: e.duration,
          blockingDuration: e.blockingDuration,
          workMs, renderMs, styleLayoutMs,
          scripts: (e.scripts ?? []).map((s) => ({
            sourceURL: s.sourceURL,
            functionName: s.sourceFunctionName,
            charPos: s.sourceCharPosition,
            duration: s.duration,
            invoker: s.invoker,
            invokerType: s.invokerType,
            forcedLayoutMs: s.forcedStyleAndLayoutDuration,
            pauseMs: s.pauseDuration,
          })),
        });
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
    w.__loafSupported = true;
  } catch { w.__loafSupported = false; }

  w.__drainTasks = () => { const t = w.__tasks!; w.__tasks = []; return t; };
}

export class RendererTasks implements Detector {
  readonly name = 'renderer-task';
  private timer?: ReturnType<typeof setInterval>;
  private inflight = false;
  private out: JsonlWriter;
  loafSupported = false;
  constructor(private readonly ctx: DetectorCtx) {
    this.out = new JsonlWriter(join(ctx.runDir, 'renderer-tasks.jsonl'));
  }

  async start(): Promise<void> {
    await this.ctx.page.addInitScript(installTaskObservers);
    await this.ctx.page.evaluate(installTaskObservers).catch(() => {});
    this.loafSupported = (await this.ctx.page
      .evaluate(() => (window as unknown as { __loafSupported?: boolean }).__loafSupported ?? false)
      .catch(() => false)) as boolean;
    if (!this.loafSupported) log('warn', '[L2] LoAF unsupported — falling back to longtask only');
    this.timer = setInterval(() => { void this.poll(); }, this.ctx.config.metricsIntervalMs);
  }

  private async poll(): Promise<void> {
    if (this.inflight) return;
    this.inflight = true;
    try {
      const tasks = (await this.ctx.page.evaluate(
        () => (window as unknown as { __drainTasks?: () => DrainedTask[] }).__drainTasks?.() ?? [],
      )) as DrainedTask[];
      for (const t of tasks) {
        if (t.duration < 50) continue;
        await this.out.append(t);
        const blockMs = t.blockingDuration ?? t.duration;
        if (blockMs >= this.ctx.config.heartbeatMs) {
          const durationMs = Math.round(blockMs);
          this.ctx.bus.emit({
            layer: 'renderer-task',
            startIso: new Date(t.time).toISOString(),
            durationMs,
            severity: severityFor(durationMs),
            detail: {
              kind: t.kind, durationMs: Math.round(t.duration),
              workMs: t.workMs != null ? Math.round(t.workMs) : undefined,
              renderMs: t.renderMs != null ? Math.round(t.renderMs) : undefined,
              styleLayoutMs: t.styleLayoutMs != null ? Math.round(t.styleLayoutMs) : undefined,
              scripts: t.scripts ?? [],
            },
          });
        }
      }
    } catch {
      /* page closed — ignore */
    } finally {
      this.inflight = false;
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.poll();
    await this.out.close();
  }
}
