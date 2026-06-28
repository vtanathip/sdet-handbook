import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CDPSession } from 'playwright';
import type { Detector, DetectorCtx } from '../detector.js';
import { log } from '../util/logger.js';

// L6 — deep evidence.
// A freeze is detected on RECOVERY, so we can't start capturing after the fact and still catch the
// hung stack. Instead we trace the whole run via CDP Tracing → trace.json. The category list
// includes `disabled-by-default-v8.cpu_profiler`, so the trace embeds sampled call stacks — the
// hung stack sits at the freeze timestamps the report lists. Load trace.json in chrome://tracing,
// Perfetto, or DevTools → Performance (import).
//
// ponytail: the CDP `Profiler` domain hangs on Electron here, and Playwright's own context tracing
// does too — so we use CDP `Tracing` only (verified working), and wrap everything in try/catch +
// timeouts so deep evidence can never hang the run.

const TRACE_CATEGORIES = [
  'disabled-by-default-devtools.timeline',
  'devtools.timeline',
  'disabled-by-default-v8.cpu_profiler',
  'v8.execute',
  'blink.user_timing',
];

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | undefined> =>
  Promise.race([p.catch(() => undefined), new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))]);

// ponytail: cap our Node-side trace buffer — a whole-run trace grows unbounded (measured tens of MB
// of JS objects in a ~30s run). Drops the OLDEST events past the cap (early freezes), keeping the
// recent window, and warns so the truncation is never silent. NB: this bounds the HARNESS process
// only; the dominant cost is Chromium's separate Tracing Service process (~120MB in that 30s run),
// which is inherent to whole-run CDP Tracing — trim TRACE_CATEGORIES or make L6 opt-in for long runs.
const MAX_TRACE_EVENTS = 300_000;

export class DeepEvidence implements Detector {
  readonly name = 'deep';
  private cdp?: CDPSession;
  private chunks: unknown[] = [];
  private dropped = 0;
  private tracing = false;
  constructor(private readonly ctx: DetectorCtx) {}

  async start(): Promise<void> {
    try {
      this.cdp = await this.ctx.page.context().newCDPSession(this.ctx.page);
      this.cdp.on('Tracing.dataCollected', (e: { value: unknown[] }) => {
        this.chunks.push(...e.value);
        if (this.chunks.length > MAX_TRACE_EVENTS) {
          this.dropped += this.chunks.length - MAX_TRACE_EVENTS;
          this.chunks.splice(0, this.chunks.length - MAX_TRACE_EVENTS);
        }
      });
      const started = await withTimeout(
        this.cdp.send('Tracing.start', {
          traceConfig: { includedCategories: TRACE_CATEGORIES },
          transferMode: 'ReportEvents',
        }),
        5000,
      );
      this.tracing = started !== undefined;
      if (!this.tracing) log('warn', '[L6] CDP Tracing did not start — keeping video + JSONL only');
    } catch (err) {
      log('warn', '[L6] deep evidence unavailable for this target', err);
    }
  }

  async stop(): Promise<void> {
    if (!this.cdp || !this.tracing) return;
    try {
      const done = new Promise<void>((r) => this.cdp!.once('Tracing.tracingComplete', () => r()));
      await withTimeout(this.cdp.send('Tracing.end'), 8000);
      await withTimeout(done, 8000);
      await writeFile(join(this.ctx.runDir, 'trace.json'), JSON.stringify({ traceEvents: this.chunks }));
      log('info', `[L6] wrote trace.json (${this.chunks.length} events)`);
      if (this.dropped > 0) log('warn', `[L6] trace truncated: dropped ${this.dropped} oldest events (cap ${MAX_TRACE_EVENTS}) — earliest part of the run is not in trace.json`);
    } catch (err) {
      log('warn', '[L6] failed to flush trace.json', err);
    } finally {
      await this.cdp.detach().catch(() => {});
    }
  }
}
