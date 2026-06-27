import { statfsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Detector, DetectorCtx } from '../detector.js';
import { JsonlWriter } from '../util/jsonl.js';
import { log } from '../util/logger.js';

// Storage & disk pressure — symptom-only / blind today.
//  - storage-pressure: navigator.storage.estimate() per renderer (usage vs quota) — works in ALL modes.
//  - disk-low / slow-disk: the harness's OWN Node process checks free space + write latency on the
//    app's userData volume (we only ask the bridge for the path — fs work runs here, sidestepping the
//    no-require-in-evaluate limit). Needs a main-process channel (source or cdp+inspect) for the path.

interface Estimate { usage?: number; quota?: number }

export class StorageDisk implements Detector {
  readonly name = 'storage';
  private out: JsonlWriter;
  private timer?: ReturnType<typeof setInterval>;
  private inflight = false;
  private userDataPath?: string;
  private pressureEmitted = false;
  private diskLowEmitted = false;
  private slowDiskEmitted = false;
  constructor(private readonly ctx: DetectorCtx) {
    this.out = new JsonlWriter(join(ctx.runDir, 'storage.jsonl'));
  }

  async start(): Promise<void> {
    if (this.ctx.mainBridge) {
      this.userDataPath = await this.ctx.mainBridge.getUserDataPath().catch(() => undefined);
    }
    this.timer = setInterval(() => { void this.poll(); }, 2000);
  }

  private async poll(): Promise<void> {
    if (this.inflight) return;
    this.inflight = true;
    try {
      const est = (await this.ctx.page
        .evaluate(() => (navigator.storage?.estimate ? navigator.storage.estimate() : null))
        .catch(() => null)) as Estimate | null;

      let freeBytes = -1;
      let ioMs = -1;
      if (this.userDataPath) {
        try { const s = statfsSync(this.userDataPath); freeBytes = s.bavail * s.bsize; } catch { /* ignore */ }
        try {
          const f = join(this.userDataPath, '.em-io-canary');
          const t = Date.now();
          writeFileSync(f, 'x');
          unlinkSync(f);
          ioMs = Date.now() - t;
        } catch { /* ignore */ }
      }
      await this.out.append({ ts: new Date().toISOString(), est, freeBytes, ioMs });
      this.check(est, freeBytes, ioMs);
    } catch {
      /* page/app closing — ignore */
    } finally {
      this.inflight = false;
    }
  }

  private check(est: Estimate | null, freeBytes: number, ioMs: number): void {
    const ts = new Date().toISOString();
    if (!this.pressureEmitted && est?.usage && est?.quota && est.quota > 0) {
      const pct = est.usage / est.quota;
      if (pct >= this.ctx.config.storagePct) {
        this.pressureEmitted = true;
        this.ctx.bus.emit({
          layer: 'storage', startIso: ts, durationMs: 0, severity: 'MODERATE',
          detail: { kind: 'storage-pressure', pct: Math.round(pct * 100), usageKB: Math.round(est.usage / 1024), quotaKB: Math.round(est.quota / 1024) },
        });
        log('warn', `[STORAGE] usage ${Math.round(pct * 100)}% of quota`);
      }
    }
    if (!this.diskLowEmitted && freeBytes >= 0 && freeBytes < this.ctx.config.diskLowBytes) {
      this.diskLowEmitted = true;
      this.ctx.bus.emit({
        layer: 'storage', startIso: ts, durationMs: 0, severity: 'SEVERE',
        detail: { kind: 'disk-low', freeKB: Math.round(freeBytes / 1024) },
      });
      log('error', `[STORAGE] disk low: ${Math.round(freeBytes / 1024 / 1024)}MB free`);
    }
    if (!this.slowDiskEmitted && ioMs >= 0 && ioMs > this.ctx.config.ioSlowMs) {
      this.slowDiskEmitted = true;
      this.ctx.bus.emit({
        layer: 'storage', startIso: ts, durationMs: 0, severity: 'MODERATE',
        detail: { kind: 'slow-disk', ms: ioMs },
      });
      log('warn', `[STORAGE] slow disk: ${ioMs}ms for a tiny userData write`);
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.poll();
    await this.out.close();
  }
}
