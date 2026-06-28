import { join } from 'node:path';
import type { Detector, DetectorCtx } from '../detector.js';
import { JsonlWriter } from '../util/jsonl.js';
import { log } from '../util/logger.js';

// JS errors that neither crash the process nor block a thread — today's biggest "app is broken but
// running" blind spot. Captures renderer uncaught exceptions (page 'pageerror'), console errors, and
// unhandledrejections, plus (in main-bearing modes) main-process uncaughtException/unhandledRejection.
// A preload that throws, or a contextIsolation misconfig, surfaces here instead of being invisible.
//
// These are advisory: they appear in the report but only gate the sign-off if SEVERE (see report.ts
// verdict). An uncaught exception is MODERATE; a plain console.error is MINOR.

const REJECTION_SHIM =
  "globalThis.addEventListener && globalThis.addEventListener('unhandledrejection', function(e){" +
  "var r=e&&e.reason; try{console.error('[unhandledrejection]', (r&&r.stack)||(r&&r.message)||String(r));}catch(_){}" +
  '});';

export class JsErrors implements Detector {
  readonly name = 'js-error';
  private out: JsonlWriter;
  private timer?: ReturnType<typeof setInterval>;
  private inflight = false;
  constructor(private readonly ctx: DetectorCtx) {
    this.out = new JsonlWriter(join(ctx.runDir, 'js-errors.jsonl'));
  }

  async start(): Promise<void> {
    const { page } = this.ctx;
    // unhandledrejection → console.error so it flows through page.on('console')
    await page.addInitScript({ content: REJECTION_SHIM }).catch(() => {});
    await page.evaluate(REJECTION_SHIM).catch(() => {});

    page.on('pageerror', (err) => {
      const stack = err.stack ?? '';
      // A preload throw means the exposed contextBridge API never loaded — the whole renderer is
      // broken in a specific, fixable way. Distinguish it from any other renderer uncaught.
      const where = /preload/i.test(stack) ? 'preload' : 'renderer';
      this.emit(where, 'uncaught-exception', err.message, stack);
    });
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const loc = msg.location(); // url:line:col — free, makes a console.error traceable
      const top = loc?.url ? `${loc.url}:${(loc.lineNumber ?? 0) + 1}:${(loc.columnNumber ?? 0) + 1}` : '';
      this.emit('renderer', 'console.error', msg.text(), '', top);
    });

    if (this.ctx.mainBridge) {
      await this.ctx.mainBridge.wireMainErrors();
      this.timer = setInterval(() => { void this.pollMain(); }, this.ctx.config.metricsIntervalMs);
    }
  }

  /** First V8 stack frame as `file:line:col` — the place to open. */
  private static topFrame(stack: string): string {
    const m = stack.match(/\n\s*at .*?\(?((?:[^\s()]+):(\d+):(\d+))\)?/);
    return m ? m[1] : '';
  }

  private async pollMain(): Promise<void> {
    if (!this.ctx.mainBridge || this.inflight) return;
    this.inflight = true;
    try {
      for (const e of await this.ctx.mainBridge.drainMainErrors()) this.emit('main', e.kind, e.message, e.stack);
    } catch {
      /* app closing — ignore */
    } finally {
      this.inflight = false;
    }
  }

  private emit(where: string, kind: string, message: string, stack: string, topFrameHint = ''): void {
    const severity = kind === 'console.error' ? 'MINOR' : 'MODERATE';
    const topFrame = topFrameHint || JsErrors.topFrame(stack);
    void this.out.append({ ts: new Date().toISOString(), where, kind, message, stack });
    this.ctx.bus.emit({
      layer: 'js-error', startIso: new Date().toISOString(), durationMs: 0, severity,
      // Carry topFrame + a stack tail onto the bus so the report shows WHERE it threw, not just the
      // message (the full stack still lives in js-errors.jsonl).
      detail: { kind, where, message: message.slice(0, 300), topFrame, stack: stack.slice(0, 600) },
    });
    log(severity === 'MINOR' ? 'warn' : 'error', `[JS] ${where} ${kind}: ${message.slice(0, 120)}${topFrame ? ` @ ${topFrame}` : ''}`);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.pollMain();
    await this.out.close();
  }
}
