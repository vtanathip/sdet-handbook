import { join } from 'node:path';
import type { Detector, DetectorCtx } from '../detector.js';
import { JsonlWriter } from '../util/jsonl.js';
import { log } from '../util/logger.js';

// L7 — IPC flush / backpressure.
// A renderer that floods the main process with `ipcRenderer.send` (or sends jumbo payloads) faster
// than main can drain saturates the main event loop — the app freezes while the IPC queue "won't
// flush". We count renderer→main IPC traffic in the main process (MainBridge patches ipcMain.emit)
// and flag intervals over the storm threshold. A storm usually overlaps an L3 main-loop freeze, so
// the report's incident ends up tagged `main-loop, ipc` — i.e. "this freeze was an IPC storm".
//
// Note: `ipcRenderer.invoke` is dispatched via a separate internal path and is NOT counted here; a
// jumbo invoke still shows up via L1 (renderer serialization block) + L3 (main deserialization).

export class IpcFlood implements Detector {
  readonly name = 'ipc';
  private timer?: ReturnType<typeof setInterval>;
  private inflight = false;
  private out: JsonlWriter;
  constructor(private readonly ctx: DetectorCtx) {
    this.out = new JsonlWriter(join(ctx.runDir, 'ipc.jsonl'));
  }

  async start(): Promise<void> {
    if (!this.ctx.mainBridge) { log('warn', '[L7] no main-process channel — skipping IPC monitor'); return; }
    await this.ctx.mainBridge.startIpcCounter();
    this.timer = setInterval(() => { void this.poll(); }, this.ctx.config.metricsIntervalMs);
  }

  private async poll(): Promise<void> {
    if (!this.ctx.mainBridge || this.inflight) return;
    this.inflight = true;
    try {
      const msgs = await this.ctx.mainBridge.readIpcDelta();
      if (msgs <= 0) return;
      const ts = new Date().toISOString();
      const ratePerSec = Math.round((msgs / this.ctx.config.metricsIntervalMs) * 1000);
      await this.out.append({ ts, msgs, ratePerSec });
      if (msgs >= this.ctx.config.ipcStormMsgs) {
        this.ctx.bus.emit({
          layer: 'ipc',
          startIso: new Date(Date.now() - this.ctx.config.metricsIntervalMs).toISOString(),
          durationMs: this.ctx.config.metricsIntervalMs,
          severity: 'MODERATE',
          detail: { kind: 'ipc-storm', msgs, ratePerSec },
        });
        log('warn', `[L7] IPC storm: ${msgs} msgs in ${this.ctx.config.metricsIntervalMs}ms (~${ratePerSec}/s)`);
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
    await this.out.close();
  }
}
