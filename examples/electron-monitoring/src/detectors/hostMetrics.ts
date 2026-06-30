import { join } from 'node:path';
import { cpus, loadavg, freemem, totalmem, platform, arch, hostname, release } from 'node:os';
import type { Detector, DetectorCtx } from '../detector.js';
import { JsonlWriter } from '../util/jsonl.js';
import { writeMeta } from '../runContext.js';

// Host metrics — the machine the run happened on, sampled OVER TIME (not just at start). A build's
// numbers are only trustworthy if the host wasn't under load during its run; for a build-vs-build
// sign-off this is the confounder check ("build B looked slower, but its host was at 90% CPU"). We
// sample host CPU% (from os.cpus() deltas), 1-min load average, and free memory each interval, and
// record the static box identity (CPU model, cores, platform) into meta.json.

function cpuTotals(): { idle: number; total: number } {
  let idle = 0, total = 0;
  for (const c of cpus()) { for (const k of Object.keys(c.times) as (keyof typeof c.times)[]) total += c.times[k]; idle += c.times.idle; }
  return { idle, total };
}

export class HostMetrics implements Detector {
  readonly name = 'host';
  private out: JsonlWriter;
  private timer?: ReturnType<typeof setInterval>;
  private prev = cpuTotals();
  constructor(private readonly ctx: DetectorCtx) {
    this.out = new JsonlWriter(join(ctx.runDir, 'host.jsonl'));
  }

  async start(): Promise<void> {
    const cs = cpus();
    writeMeta(this.ctx.runDir, {
      hostCpuModel: cs[0]?.model?.trim(), hostCores: cs.length,
      hostPlatform: platform(), hostArch: arch(), hostRelease: release(), hostName: hostname(),
      totalMemMB: Math.round(totalmem() / 2 ** 20),
    });
    this.prev = cpuTotals();
    this.timer = setInterval(() => this.sample(), this.ctx.config.metricsIntervalMs);
  }

  private sample(): void {
    const cur = cpuTotals();
    const dt = cur.total - this.prev.total, di = cur.idle - this.prev.idle;
    const hostCpuPct = dt > 0 ? Math.round((1 - di / dt) * 1000) / 10 : 0;
    this.prev = cur;
    void this.out.append({
      ts: new Date().toISOString(), hostCpuPct,
      loadAvg1: Math.round(loadavg()[0] * 100) / 100,
      freeMemMB: Math.round(freemem() / 2 ** 20),
    });
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.sample();
    await this.out.close();
  }
}
