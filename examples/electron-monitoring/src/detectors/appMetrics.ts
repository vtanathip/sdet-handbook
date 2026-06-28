import { join } from 'node:path';
import type { Detector, DetectorCtx } from '../detector.js';
import type { ProcSample } from '../mainBridge.js';
import { JsonlWriter } from '../util/jsonl.js';
import { log } from '../util/logger.js';

// L4 — hardware: per-process CPU / memory / GPU.
// app.getAppMetrics() returns one row per Electron process (Browser=main, Tab=renderer, GPU,
// Utility). Cross-platform analog of process-watchdog's CpuSampler. Every sample streams to
// metrics.jsonl (the report computes peak CPU near each freeze from this). Sustained high CPU or a
// memory balloon also raise a freeze event directly.
//
// ponytail: memory.workingSetSize semantics differ by OS (Windows private working set vs macOS
// resident) so we gate on a GROWTH RATIO, never an absolute MB threshold.

/** Top N processes by a key (cpu or mem), compacted for a freeze-moment snapshot in the report. */
function topProcs(samples: ProcSample[], key: 'cpu' | 'mem'): Record<string, unknown>[] {
  return [...samples]
    .sort((a, b) => b[key] - a[key])
    .slice(0, 5)
    .map((s) => ({ pid: s.pid, type: s.type, name: s.name ?? '', cpuPct: +s.cpu.toFixed(1), memKB: s.mem, peakMemKB: s.peakMem ?? 0, wakeups: s.wakeups ?? 0 }));
}

export class AppMetrics implements Detector {
  readonly name = 'hardware';
  private timer?: ReturnType<typeof setInterval>;
  private inflight = false;
  private out: JsonlWriter;
  // Per-pid memory baseline so a balloon names the SPECIFIC growing process, not just "the app".
  private memBaseline = new Map<number, { kb: number; name: string; type: string }>();
  private memEmitted = false;
  private highCpuMs = 0;
  private cpuEmitted = false;
  constructor(private readonly ctx: DetectorCtx) {
    this.out = new JsonlWriter(join(ctx.runDir, 'metrics.jsonl'));
  }

  async start(): Promise<void> {
    if (!this.ctx.mainBridge) { log('warn', '[L4] no main-process channel — skipping app metrics'); return; }
    this.timer = setInterval(() => { void this.poll(); }, this.ctx.config.metricsIntervalMs);
  }

  private async poll(): Promise<void> {
    if (!this.ctx.mainBridge || this.inflight) return;
    this.inflight = true;
    try {
      const samples = await this.ctx.mainBridge.getAppMetrics();
      if (!Array.isArray(samples) || samples.length === 0) return; // transient empty poll — skip
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
    // Per-process growth: find the single process that grew most past the ratio — that's the leaker.
    let culprit: { s: ProcSample; base: number; ratio: number; grewKB: number } | undefined;
    for (const s of samples) {
      const prev = this.memBaseline.get(s.pid);
      if (!prev) { this.memBaseline.set(s.pid, { kb: s.mem, name: s.name ?? '', type: s.type }); continue; }
      const ratio = prev.kb > 0 ? s.mem / prev.kb : 1;
      const grewKB = s.mem - prev.kb;
      if (ratio >= this.ctx.config.memGrowthRatio && (!culprit || grewKB > culprit.grewKB)) {
        culprit = { s, base: prev.kb, ratio, grewKB };
      }
    }
    if (!this.memEmitted && culprit) {
      this.memEmitted = true;
      const { s, base, ratio } = culprit;
      this.ctx.bus.emit({
        layer: 'hardware', startIso: ts, durationMs: 0, severity: 'MODERATE',
        detail: { kind: 'memory-balloon', type: s.type, pid: s.pid, name: s.name ?? '',
          baselineKB: base, currentKB: s.mem, peakKB: s.peakMem ?? 0, ratio: +ratio.toFixed(2),
          procs: topProcs(samples, 'mem') },
      });
      log('warn', `[L4] ${s.name || s.type} (pid ${s.pid}) memory grew ${ratio.toFixed(2)}x (${s.mem}KB)`);
    }
  }

  private checkCpu(samples: ProcSample[], ts: string): void {
    void ts;
    const hot = samples.filter((s) => s.cpu > this.ctx.config.cpuPctThreshold);
    if (hot.length === 0) { this.highCpuMs = 0; this.cpuEmitted = false; return; }
    this.highCpuMs += this.ctx.config.metricsIntervalMs;
    if (!this.cpuEmitted && this.highCpuMs >= 2000) {
      this.cpuEmitted = true;
      const peak = hot.reduce((a, s) => (s.cpu > a.cpu ? s : a));
      this.ctx.bus.emit({
        layer: 'hardware', startIso: new Date(Date.now() - this.highCpuMs).toISOString(),
        durationMs: this.highCpuMs, severity: 'MODERATE',
        detail: { kind: 'sustained-cpu', process: peak.type, name: peak.name ?? '', pid: peak.pid,
          cpuPct: +peak.cpu.toFixed(1), wakeups: peak.wakeups ?? 0, procs: topProcs(samples, 'cpu') },
      });
      log('warn', `[L4] sustained CPU ${peak.cpu.toFixed(1)}% on ${peak.name || peak.type}`);
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.poll();
    await this.out.close();
  }
}
