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

    page.on('pageerror', (err) => this.emit('renderer', 'uncaught-exception', err.message, err.stack ?? ''));
    page.on('console', (msg) => {
      if (msg.type() === 'error') this.emit('renderer', 'console.error', msg.text(), '');
    });

    if (this.ctx.mainBridge) {
      await this.ctx.mainBridge.wireMainErrors();
      this.timer = setInterval(() => { void this.pollMain(); }, this.ctx.config.metricsIntervalMs);
    }
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

  private emit(where: string, kind: string, message: string, stack: string): void {
    const severity = kind === 'console.error' ? 'MINOR' : 'MODERATE';
    void this.out.append({ ts: new Date().toISOString(), where, kind, message, stack });
    this.ctx.bus.emit({
      layer: 'js-error', startIso: new Date().toISOString(), durationMs: 0, severity,
      detail: { kind, where, message: message.slice(0, 300) },
    });
    log(severity === 'MINOR' ? 'warn' : 'error', `[JS] ${where} ${kind}: ${message.slice(0, 120)}`);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.pollMain();
    await this.out.close();
  }
}
