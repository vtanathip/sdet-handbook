import { join } from 'node:path';
import type { Detector, DetectorCtx } from '../detector.js';
import { JsonlWriter } from '../util/jsonl.js';
import { log } from '../util/logger.js';

// L7 — IPC flush / backpressure.
// A renderer that floods the main process with `ipcRenderer.send` (or sends jumbo payloads) faster
// than main can drain saturates the main event loop — the app freezes while the IPC queue "won't
// flush". We count renderer→main IPC traffic PER CHANNEL in the main process (MainBridge patches
// ipcMain.emit for send/sendSync and ipcMain.handle for invoke) and flag intervals over the storm
// threshold. The per-channel breakdown names the offending channel ("cursor-move sent 94%") so the
// engineer goes straight to the call-site. A storm usually overlaps an L3 main-loop freeze, so the
// report's incident ends up tagged `main-loop, ipc` — i.e. "this freeze was an IPC storm".

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
      const counts = await this.ctx.mainBridge.readIpcCounts();
      const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const msgs = ranked.reduce((a, [, n]) => a + n, 0);
      if (msgs <= 0) return;
      const ts = new Date().toISOString();
      const ratePerSec = Math.round((msgs / this.ctx.config.metricsIntervalMs) * 1000);
      // top 3 channels: split the `transport:channel` key back apart for the report.
      const channels = ranked.slice(0, 3).map(([k, count]) => {
        const i = k.indexOf(':');
        return { transport: k.slice(0, i), channel: k.slice(i + 1), count };
      });
      await this.out.append({ ts, msgs, ratePerSec, channels });
      if (msgs >= this.ctx.config.ipcStormMsgs) {
        const top = channels[0];
        const topPct = Math.round((top.count / msgs) * 100);
        this.ctx.bus.emit({
          layer: 'ipc',
          startIso: new Date(Date.now() - this.ctx.config.metricsIntervalMs).toISOString(),
          durationMs: this.ctx.config.metricsIntervalMs,
          severity: 'MODERATE',
          detail: { kind: 'ipc-storm', msgs, ratePerSec, topChannel: top.channel, topTransport: top.transport, topPct, channels },
        });
        log('warn', `[L7] IPC storm: ${msgs} msgs (~${ratePerSec}/s) — top '${top.transport}:${top.channel}' ${topPct}%`);
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
