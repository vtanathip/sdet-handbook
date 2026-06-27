import { join } from 'node:path';
import type { Detector, DetectorCtx } from '../detector.js';
import { JsonlWriter } from '../util/jsonl.js';
import { log } from '../util/logger.js';

// Subprocess lifecycle — child_process.spawn/exec/fork of external binaries (ffmpeg, git, sidecars…).
// child-process-gone only covers Chromium helpers, so a forked worker that crashes or a spawn that
// hangs is otherwise invisible. We patch child_process in the main process (via the bridge) and flag
// children that exit abnormally (crash) or stay alive past subprocessHungMs (hung).
//
// Limitation: needs the inspector channel (require) — available in cdp+inspect, not source mode; and
// only catches spawns made through the child_process module object after we attach (code that
// destructured `const {spawn}=require('child_process')` at load keeps the original, unpatched ref).

export class Subprocess implements Detector {
  readonly name = 'subprocess';
  private out: JsonlWriter;
  private timer?: ReturnType<typeof setInterval>;
  private inflight = false;
  private supported = false;
  private flaggedHung = new Set<number>();
  constructor(private readonly ctx: DetectorCtx) {
    this.out = new JsonlWriter(join(ctx.runDir, 'subprocess.jsonl'));
  }

  async start(): Promise<void> {
    if (!this.ctx.mainBridge) { log('warn', '[SUBPROC] no main-process channel — skipping'); return; }
    this.supported = await this.ctx.mainBridge.wireChildProcs().catch(() => false);
    if (!this.supported) { log('warn', '[SUBPROC] unavailable in this mode (needs cdp+inspect)'); return; }
    this.timer = setInterval(() => { void this.poll(); }, this.ctx.config.metricsIntervalMs);
  }

  private async poll(): Promise<void> {
    if (!this.ctx.mainBridge || !this.supported || this.inflight) return;
    this.inflight = true;
    try {
      for (const e of await this.ctx.mainBridge.drainChildProcs()) {
        await this.out.append(e);
        if (e.kind === 'exit' && (e.code || e.signal)) {
          this.ctx.bus.emit({
            layer: 'subprocess', startIso: new Date(e.t).toISOString(), durationMs: 0, severity: 'SEVERE',
            detail: { kind: 'subprocess-crashed', cmd: e.cmd, pid: e.pid, code: e.code, signal: e.signal },
          });
          log('error', `[SUBPROC] ${e.cmd} (pid ${e.pid}) exited abnormally code=${e.code} signal=${e.signal}`);
        }
      }
      for (const c of await this.ctx.mainBridge.readLiveChildren()) {
        if (c.ageMs > this.ctx.config.subprocessHungMs && !this.flaggedHung.has(c.pid)) {
          this.flaggedHung.add(c.pid);
          this.ctx.bus.emit({
            layer: 'subprocess', startIso: new Date(Date.now() - c.ageMs).toISOString(), durationMs: c.ageMs, severity: 'MODERATE',
            detail: { kind: 'subprocess-hung', cmd: c.cmd, pid: c.pid, ageMs: c.ageMs },
          });
          log('warn', `[SUBPROC] ${c.cmd} (pid ${c.pid}) still running after ${Math.round(c.ageMs / 1000)}s`);
        }
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
