import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Reduces a run's raw evidence streams into RICH per-layer summaries + a few real sample records —
// what the report shows so you can trace what the app actually did, not just "N records captured".
// Whole-run (not per-step; that's compare.ts/readRunSteps). One-directional: report.ts imports this.

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
}
function pct(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))]);
}
const fmtKB = (bytes: number): string => bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : bytes >= 1024 ? (bytes / 1024).toFixed(1) + ' KB' : bytes + ' B';

interface IpcMsg { t: number; transport: string; channel: string; dir: 'r2m' | 'm2r'; bytes: number; argTypes: string[]; preview: string; latencyMs?: number; at?: string }
interface LoopRec { ts: string; kind: string; maxLagMs?: number; channel?: string; handlerKind?: string; durationMs?: number }
interface MetricSample { ts: string; samples: { pid: number; type: string; cpu: number; mem: number; name?: string; peakMem?: number }[] }
interface NetRec { ts: string; url: string; method?: string; status?: number; durationMs: number; bytes?: number; errorText?: string; initiator?: string }
interface ErrRec { ts: string; where: string; kind: string; message: string; topFrame?: string }
interface HbGap { ts: string; gapMs: number; route?: string }
interface StorageOp { ts: string; area?: string; op?: string; key?: string; valueBytes?: number; at?: string; kind?: string; local?: { key: string; bytes: number }[]; session?: { key: string; bytes: number }[] }
interface HostSample { ts: string; hostCpuPct: number; loadAvg1: number; freeMemMB: number }

export interface IpcChannelStat { channel: string; transport: string; dir: string; count: number; bytes: number; avgLatencyMs?: number; maxLatencyMs?: number; at?: string }
export interface EvidenceSummary {
  ipc: {
    total: number; r2m: number; m2r: number; bytes: number; dropped: number;
    byTransport: Record<string, number>;
    channels: IpcChannelStat[];                 // top channels by count
    slowestInvokes: { channel: string; latencyMs: number }[];
    samples: { transport: string; channel: string; dir: string; size: string; preview: string }[];
  };
  network: { total: number; failed: number; slowest: { url: string; status?: number; ms: number; size: string; initiator?: string }[] };
  mainLoop: { lagSamples: number; lagP50: number; lagP95: number; lagMax: number; handlers: { label: string; calls: number; maxMs: number; totalMs: number }[] };
  cpuMem: { processes: { name: string; peakCpu: number; peakMemMB: number }[] };
  errors: { kind: string; where: string; message: string; at?: string }[];
  heartbeat: { jankCount: number; worstMs: number; routes: { route: string; count: number; worstMs: number }[] };
  // Storage writes the app made while running, traced to the call-site that wrote each key.
  storageOps: { total: number; sets: number; removes: number; clears: number; byKey: { key: string; area: string; writes: number; bytes: number; at: string }[]; snapshotKeys: number; snapshotBytes: number };
  // Host metrics over the run, with app-vs-host CPU attribution (is the load OUR app or the box?).
  host: { cpuModel?: string; cores?: number; platform?: string; samples: number; hostCpuPeak: number; hostCpuAvg: number; appCpuPeak: number; freeMemLowMB: number; loadPeak: number } | null;
  counts: { file: string; what: string; count: number }[];
}

const STREAM_INFO: { file: string; what: string }[] = [
  { file: 'actions.jsonl', what: 'scenario steps' },
  { file: 'heartbeat.jsonl', what: 'renderer UI-thread jank gaps' },
  { file: 'renderer-tasks.jsonl', what: 'long tasks + LoAF scripts' },
  { file: 'main-loop.jsonl', what: 'main-loop lag + handler timings' },
  { file: 'metrics.jsonl', what: 'per-process CPU / memory' },
  { file: 'ipc.jsonl', what: 'every IPC message (both directions)' },
  { file: 'network.jsonl', what: 'every request' },
  { file: 'js-errors.jsonl', what: 'errors / rejections' },
  { file: 'breadcrumbs.jsonl', what: "the app's console output" },
  { file: 'storage.jsonl', what: 'storage / disk / I/O' },
  { file: 'storage-ops.jsonl', what: 'localStorage/sessionStorage writes + call-site' },
  { file: 'heap.jsonl', what: 'renderer JS heap per route' },
  { file: 'routes.jsonl', what: 'route navigations' },
  { file: 'host.jsonl', what: 'host CPU / memory / load over the run' },
  { file: 'subprocess.jsonl', what: 'child processes' },
  { file: 'freezes.jsonl', what: 'freeze events (all layers)' },
];

export function readEvidenceSummary(runDir: string): EvidenceSummary {
  const ipcMsgs = readJsonl<IpcMsg>(join(runDir, 'ipc.jsonl'));
  const loop = readJsonl<LoopRec>(join(runDir, 'main-loop.jsonl'));
  const metrics = readJsonl<MetricSample>(join(runDir, 'metrics.jsonl'));
  const net = readJsonl<NetRec>(join(runDir, 'network.jsonl'));
  const errs = readJsonl<ErrRec>(join(runDir, 'js-errors.jsonl'));
  const hb = readJsonl<HbGap>(join(runDir, 'heartbeat.jsonl'));

  // ── IPC ──────────────────────────────────────────────────────────────────────────────────────
  // Call-site map (which app service called each channel): from `at` on the records (renderer-tap
  // mode) or from ipc-callsites.jsonl (main-tap mode, harvested by the renderer call-site recorder).
  const callsiteByChannel = new Map<string, string>();
  for (const m of ipcMsgs) if (m.at && !callsiteByChannel.has(m.channel)) callsiteByChannel.set(m.channel, m.at);
  for (const c of readJsonl<{ channel: string; at: string }>(join(runDir, 'ipc-callsites.jsonl'))) {
    if (c.at && !callsiteByChannel.has(c.channel)) callsiteByChannel.set(c.channel, c.at);
  }
  const byTransport: Record<string, number> = {};
  const chanMap = new Map<string, IpcChannelStat & { latencies: number[] }>();
  const latByChannel = new Map<string, number[]>();
  let r2m = 0, m2r = 0, bytes = 0;
  for (const m of ipcMsgs) {
    byTransport[m.transport] = (byTransport[m.transport] ?? 0) + 1;
    bytes += m.bytes || 0;
    if (m.dir === 'r2m') r2m++; else m2r++;
    if (m.transport === 'invoke-reply') {
      if (m.latencyMs != null) (latByChannel.get(m.channel) ?? latByChannel.set(m.channel, []).get(m.channel)!).push(m.latencyMs);
      continue; // replies are folded into their request channel's latency, not counted as a channel row
    }
    const key = `${m.transport}:${m.channel}`;
    const c = chanMap.get(key) ?? chanMap.set(key, { channel: m.channel, transport: m.transport, dir: m.dir, count: 0, bytes: 0, latencies: [] }).get(key)!;
    c.count++; c.bytes += m.bytes || 0;
  }
  for (const c of chanMap.values()) {
    const lat = latByChannel.get(c.channel);
    if (lat?.length) { c.avgLatencyMs = Math.round(lat.reduce((a, b) => a + b, 0) / lat.length); c.maxLatencyMs = Math.max(...lat); }
    c.at = callsiteByChannel.get(c.channel);
  }
  const channels = [...chanMap.values()].sort((a, b) => b.count - a.count).slice(0, 8)
    .map(({ latencies, ...c }) => c); // drop internal latencies bag
  const slowestInvokes = [...latByChannel.entries()].map(([channel, l]) => ({ channel, latencyMs: Math.max(...l) }))
    .sort((a, b) => b.latencyMs - a.latencyMs).slice(0, 5);
  // A few real sample messages — prefer variety (one per transport), then fill with the largest payloads.
  const samples: EvidenceSummary['ipc']['samples'] = [];
  const seenT = new Set<string>();
  for (const m of ipcMsgs) {
    if (seenT.has(m.transport) || m.transport === 'invoke-reply') continue;
    seenT.add(m.transport);
    samples.push({ transport: m.transport, channel: m.channel, dir: m.dir, size: fmtKB(m.bytes || 0), preview: (m.preview || '').slice(0, 120) });
    if (samples.length >= 6) break;
  }

  // ── main loop ────────────────────────────────────────────────────────────────────────────────
  const lags = loop.filter((r) => r.kind === 'lag').map((r) => r.maxLagMs ?? 0);
  const hMap = new Map<string, { label: string; calls: number; maxMs: number; totalMs: number }>();
  for (const r of loop) {
    if (r.kind !== 'handler' || !r.channel) continue;
    const label = `${r.channel} (${r.handlerKind === 'on' ? 'on' : 'invoke'})`;
    const h = hMap.get(label) ?? hMap.set(label, { label, calls: 0, maxMs: 0, totalMs: 0 }).get(label)!;
    h.calls++; h.maxMs = Math.max(h.maxMs, r.durationMs ?? 0); h.totalMs += r.durationMs ?? 0;
  }
  const handlers = [...hMap.values()].sort((a, b) => b.maxMs - a.maxMs).slice(0, 8);

  // ── CPU / memory ─────────────────────────────────────────────────────────────────────────────
  const procMap = new Map<string, { name: string; peakCpu: number; peakMemMB: number }>();
  for (const s of metrics) for (const p of s.samples ?? []) {
    const name = p.name || p.type;
    if (name === 'Tracing Service') continue; // our own instrument
    const e = procMap.get(name) ?? procMap.set(name, { name, peakCpu: 0, peakMemMB: 0 }).get(name)!;
    e.peakCpu = Math.max(e.peakCpu, +p.cpu.toFixed(1));
    e.peakMemMB = Math.max(e.peakMemMB, Math.round((p.peakMem ?? p.mem) / 1024));
  }
  const processes = [...procMap.values()].sort((a, b) => b.peakMemMB - a.peakMemMB).slice(0, 6);

  // ── network / errors / heartbeat ───────────────────────────────────────────────────────────────
  const network = {
    total: net.length,
    failed: net.filter((r) => r.errorText).length,
    slowest: [...net].sort((a, b) => b.durationMs - a.durationMs).slice(0, 6)
      .map((r) => ({ url: r.url, status: r.errorText ? undefined : r.status, ms: Math.round(r.durationMs), size: fmtKB(r.bytes || 0), initiator: r.initiator })),
  };
  const errors = errs.slice(0, 10).map((e) => ({ kind: e.kind, where: e.where, message: (e.message || '').slice(0, 160), at: e.topFrame }));
  const routeMap = new Map<string, { route: string; count: number; worstMs: number }>();
  for (const g of hb) {
    const route = g.route ?? '(unknown)';
    const e = routeMap.get(route) ?? routeMap.set(route, { route, count: 0, worstMs: 0 }).get(route)!;
    e.count++; e.worstMs = Math.max(e.worstMs, g.gapMs);
  }
  const heartbeat = {
    jankCount: hb.length,
    worstMs: hb.reduce((m, g) => Math.max(m, g.gapMs), 0),
    routes: [...routeMap.values()].sort((a, b) => b.worstMs - a.worstMs).slice(0, 5),
  };

  // ── storage writes, traced to the call-site that wrote each key ──────────────────────────────────
  const sops = readJsonl<StorageOp>(join(runDir, 'storage-ops.jsonl'));
  const opRecs = sops.filter((o) => o.kind !== 'snapshot' && o.op);
  const snap = sops.find((o) => o.kind === 'snapshot');
  const keyMap = new Map<string, { key: string; area: string; writes: number; bytes: number; at: string }>();
  for (const o of opRecs) {
    if (o.op !== 'set') continue;
    const k = `${o.area}:${o.key}`;
    const e = keyMap.get(k) ?? keyMap.set(k, { key: o.key ?? '', area: o.area ?? '', writes: 0, bytes: 0, at: '' }).get(k)!;
    e.writes++; e.bytes = o.valueBytes ?? e.bytes; if (o.at) e.at = o.at;
  }
  const snapKeys = (snap?.local?.length ?? 0) + (snap?.session?.length ?? 0);
  const snapBytes = [...(snap?.local ?? []), ...(snap?.session ?? [])].reduce((a, x) => a + (x.bytes || 0), 0);
  const storageOps = {
    total: opRecs.length,
    sets: opRecs.filter((o) => o.op === 'set').length,
    removes: opRecs.filter((o) => o.op === 'remove').length,
    clears: opRecs.filter((o) => o.op === 'clear').length,
    byKey: [...keyMap.values()].sort((a, b) => b.writes - a.writes).slice(0, 10),
    snapshotKeys: snapKeys, snapshotBytes: snapBytes,
  };

  // ── host metrics + app-vs-host CPU attribution ───────────────────────────────────────────────────
  const hostSamples = readJsonl<HostSample>(join(runDir, 'host.jsonl'));
  let meta: Record<string, unknown> = {};
  try { meta = JSON.parse(readFileSync(join(runDir, 'meta.json'), 'utf8')) as Record<string, unknown>; } catch { /* none */ }
  // The app's own processes' combined CPU at each metrics sample → peak app CPU (vs whole-host CPU).
  let appCpuPeak = 0;
  for (const s of metrics) {
    const appCpu = (s.samples ?? []).filter((p) => (p.name || p.type) !== 'Tracing Service').reduce((a, p) => a + (p.cpu || 0), 0);
    appCpuPeak = Math.max(appCpuPeak, appCpu);
  }
  const host = hostSamples.length > 0 || meta.hostCpuModel ? {
    cpuModel: meta.hostCpuModel as string | undefined, cores: meta.hostCores as number | undefined, platform: meta.hostPlatform as string | undefined,
    samples: hostSamples.length,
    hostCpuPeak: hostSamples.reduce((m, s) => Math.max(m, s.hostCpuPct), 0),
    hostCpuAvg: hostSamples.length ? Math.round(hostSamples.reduce((a, s) => a + s.hostCpuPct, 0) / hostSamples.length * 10) / 10 : 0,
    appCpuPeak: Math.round(appCpuPeak),
    freeMemLowMB: hostSamples.length ? Math.min(...hostSamples.map((s) => s.freeMemMB)) : 0,
    loadPeak: hostSamples.reduce((m, s) => Math.max(m, s.loadAvg1), 0),
  } : null;

  const counts = STREAM_INFO
    .map((s) => ({ ...s, count: readJsonl<unknown>(join(runDir, s.file)).length }))
    .filter((s) => s.count > 0);

  return {
    ipc: { total: ipcMsgs.length, r2m, m2r, bytes, dropped: 0, byTransport, channels, slowestInvokes, samples },
    network, mainLoop: { lagSamples: lags.length, lagP50: pct(lags, 0.5), lagP95: pct(lags, 0.95), lagMax: lags.length ? Math.max(...lags) : 0, handlers },
    cpuMem: { processes }, errors, heartbeat, storageOps, host, counts,
  };
}

export { fmtKB };
