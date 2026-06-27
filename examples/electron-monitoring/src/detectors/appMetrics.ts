import { join } from 'node:path';
import type { Detector, DetectorCtx } from '../detector.js';
import { JsonlWriter } from '../util/jsonl.js';
import { log } from '../util/logger.js';

// L4 — hardware: per-process CPU / memory / GPU.
// app.getAppMetrics() returns one row per Electron process (Browser=main, Tab=renderer, GPU,
// Utility). Cross-platform analog of process-watchdog's CpuSampler. Every sample streams to
// metrics.jsonl (the report computes peak CPU near each freeze from this). Sustained high CPU
// or a memory balloon also raise a freeze event directly.
//
// ponytail: memory.workingSetSize semantics differ by OS (Windows private working set vs macOS
// resident) so we gate on a GROWTH RATIO, never an absolute MB threshold.

interface ProcSample { pid: number; type: string; cpu: number; mem: number }

export class AppMetrics implements Detector {
  readonly name = 'hardware';
  private timer?: ReturnType<typeof setInterval>;
  private inflight = false;
  private out: JsonlWriter;
  private baselineMem = 0;
  private memEmitted = false;
  private highCpuMs = 0;
  private cpuEmitted = false;
  constructor(private readonly ctx: DetectorCtx) {
    this.out = new JsonlWriter(join(ctx.runDir, 'metrics.jsonl'));
  }

  async start(): Promise<void> {
    if (!this.ctx.electronApp) { log('warn', '[L4] unavailable (cdp mode) — skipping app metrics'); return; }
    this.timer = setInterval(() => { void this.poll(); }, this.ctx.config.metricsIntervalMs);
  }

  private async poll(): Promise<void> {
    const app = this.ctx.electronApp;
    if (!app || this.inflight) return;
    this.inflight = true;
    try {
      const samples = await app.evaluate(({ app: electronApp }) =>
        electronApp.getAppMetrics().map((m) => ({
          pid: m.pid,
          type: m.type,
          cpu: m.cpu?.percentCPUUsage ?? 0,
          mem: m.memory?.workingSetSize ?? 0,
        })),
      ) as ProcSample[];

      const ts = new Date().toISOString();
      await this.out.append({ ts, samples });
      this.checkMemory(samples, ts);
      this.checkCpu(samples, ts);
    } catch {
      /* app closing — ignore */
    } finally {
      this.inflight = false;
    }
  }

  private checkMemory(samples: ProcSample[], ts: string): void {
    const total = samples.reduce((a, s) => a + s.mem, 0);
    if (this.baselineMem === 0) { this.baselineMem = total; return; }
    if (!this.memEmitted && total / this.baselineMem >= this.ctx.config.memGrowthRatio) {
      this.memEmitted = true;
      this.ctx.bus.emit({
        layer: 'hardware',
        startIso: ts,
        durationMs: 0,
        severity: 'MODERATE',
        detail: { kind: 'memory-balloon', baselineKB: this.baselineMem, currentKB: total,
          ratio: +(total / this.baselineMem).toFixed(2) },
      });
      log('warn', `[L4] memory grew ${(total / this.baselineMem).toFixed(2)}x (${total}KB)`);
    }
  }

  private checkCpu(samples: ProcSample[], ts: string): void {
    const hot = samples.filter((s) => s.cpu > this.ctx.config.cpuPctThreshold);
    if (hot.length === 0) { this.highCpuMs = 0; this.cpuEmitted = false; return; }
    this.highCpuMs += this.ctx.config.metricsIntervalMs;
    if (!this.cpuEmitted && this.highCpuMs >= 2000) {
      this.cpuEmitted = true;
      const peak = hot.reduce((a, s) => (s.cpu > a.cpu ? s : a));
      this.ctx.bus.emit({
        layer: 'hardware',
        startIso: new Date(Date.now() - this.highCpuMs).toISOString(),
        durationMs: this.highCpuMs,
        severity: 'MODERATE',
        detail: { kind: 'sustained-cpu', process: peak.type, pid: peak.pid, cpuPct: +peak.cpu.toFixed(1) },
      });
      log('warn', `[L4] sustained CPU ${peak.cpu.toFixed(1)}% on ${peak.type}`);
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.poll();
    await this.out.close();
  }
}
