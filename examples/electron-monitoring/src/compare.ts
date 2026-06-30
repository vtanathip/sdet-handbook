import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Build-vs-build diff. Runs the SAME scenario against two builds (old, new), each producing a run
// directory full of per-layer evidence streams; this module reduces each run to PER-STEP metrics
// (keyed by the scenario step name), then diffs them. The headline — per the tool's purpose — is
// what changed in TIMING and what changed in FREEZING per step. Everything here is decoupled from
// report.ts (one-directional: report.ts imports this, never the reverse) so there is no import cycle.

// ── tiny shared formatters (duplicated, not imported, to keep this module dependency-free) ───────────
const fmtSec = (ms: number) => (ms / 1000).toFixed(2) + 's';
const fmtPct = (n: number) => (n >= 0 ? '+' : '') + Math.round(n) + '%';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const VERDICT_EMOJI = { PASS: '✅', CAUTION: '⚠️', FAIL: '❌' } as const;
export type Verdict = 'PASS' | 'CAUTION' | 'FAIL';

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
}
function p95(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]);
}

interface ActionWindow { name: string; startIso: string; endIso: string }
interface FreezeEvt { layer: string; startIso: string; durationMs: number; action?: string }
interface IpcMsg { t: number; transport: string; channel: string; latencyMs?: number }
interface HbGap { ts: string; gapMs: number }
interface LoopRec { ts: string; kind: string; maxLagMs?: number; durationMs?: number }
interface NetRec { ts: string; durationMs: number }
interface ErrRec { ts: string }

/** Per-step metrics for one run — the unit of comparison. */
export interface StepMetrics {
  name: string;
  startIso: string; endIso: string;
  durationMs: number;          // wall-clock of the step (the primary timing signal)
  worstUiGapMs: number;        // worst renderer UI-thread gap during the step
  worstMainLagMs: number;      // worst main-process event-loop lag during the step
  ipcMsgs: number;             // renderer→main IPC messages during the step
  ipcReplyP95Ms: number;       // p95 invoke round-trip latency during the step
  topIpcChannels: { channel: string; count: number }[];
  froze: boolean;
  worstFreezeMs: number;
  freezeLayers: string[];
  jsErrors: number;
  netRequests: number;
  slowestNetMs: number;
}

export interface RunSummary {
  createdIso: string;
  build: { label: string; version?: string };
  steps: StepMetrics[];
}

function withinMs(t: number, lo: number, hi: number): boolean { return t >= lo && t <= hi; }

/** Reduce a run directory to per-step metrics by windowing each evidence stream to the step's span. */
export function readRunSteps(runDir: string): StepMetrics[] {
  const actions = readJsonl<ActionWindow>(join(runDir, 'actions.jsonl'));
  const hb = readJsonl<HbGap>(join(runDir, 'heartbeat.jsonl'));
  const loop = readJsonl<LoopRec>(join(runDir, 'main-loop.jsonl'));
  const ipc = readJsonl<IpcMsg>(join(runDir, 'ipc.jsonl'));
  const net = readJsonl<NetRec>(join(runDir, 'network.jsonl'));
  const err = readJsonl<ErrRec>(join(runDir, 'js-errors.jsonl'));
  const freezes = readJsonl<FreezeEvt>(join(runDir, 'freezes.jsonl'));

  const seen = new Map<string, number>();
  return actions.map((a) => {
    // Disambiguate repeated step names so the join key stays unique.
    const n = (seen.get(a.name) ?? 0) + 1; seen.set(a.name, n);
    const name = n > 1 ? `${a.name} (${n})` : a.name;
    const lo = Date.parse(a.startIso), hi = Date.parse(a.endIso);

    const uiGaps = hb.filter((g) => withinMs(Date.parse(g.ts), lo, hi)).map((g) => g.gapMs);
    const lags = loop.filter((r) => r.kind === 'lag' && withinMs(Date.parse(r.ts), lo, hi)).map((r) => r.maxLagMs ?? 0);
    const msgs = ipc.filter((m) => m.transport !== 'invoke-reply' && withinMs(m.t, lo, hi));
    const replies = ipc.filter((m) => m.transport === 'invoke-reply' && m.latencyMs != null && withinMs(m.t, lo, hi)).map((m) => m.latencyMs!);
    const byCh: Record<string, number> = {};
    for (const m of msgs) byCh[m.channel] = (byCh[m.channel] ?? 0) + 1;
    const nets = net.filter((r) => withinMs(Date.parse(r.ts), lo, hi));
    const fz = freezes.filter((f) => withinMs(Date.parse(f.startIso), lo - 300, hi + 300));

    return {
      name, startIso: a.startIso, endIso: a.endIso,
      durationMs: Math.max(0, hi - lo),
      worstUiGapMs: uiGaps.length ? Math.max(...uiGaps) : 0,
      worstMainLagMs: lags.length ? Math.max(...lags) : 0,
      ipcMsgs: msgs.length,
      ipcReplyP95Ms: p95(replies),
      topIpcChannels: Object.entries(byCh).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([channel, count]) => ({ channel, count })),
      froze: fz.length > 0,
      worstFreezeMs: fz.reduce((m, f) => Math.max(m, f.durationMs), 0),
      freezeLayers: [...new Set(fz.map((f) => f.layer))],
      jsErrors: err.filter((e) => withinMs(Date.parse(e.ts), lo, hi)).length,
      netRequests: nets.length,
      slowestNetMs: nets.reduce((m, r) => Math.max(m, r.durationMs), 0),
    };
  });
}

/** Whole-run summary (for SAVE_BASELINE → build-baseline.json). */
export function summarizeRun(runDir: string, createdIso: string, build: { label: string; version?: string }): RunSummary {
  return { createdIso, build, steps: readRunSteps(runDir) };
}

// ── the diff ─────────────────────────────────────────────────────────────────────────────────────
export interface StepDiff {
  name: string;
  status: 'common' | 'added' | 'removed';
  old?: StepMetrics; new?: StepMetrics;
  durationDeltaMs: number; durationDeltaPct: number;
  timingRegressed: boolean;
  freezeRegressed: boolean;      // new freeze appeared, or worst freeze grew past tolerance
  newFreeze: boolean;
  severe: boolean;               // the regressed freeze is ≥3s
  notes: string[];               // human-readable evidence deltas explaining the change
}
export interface RunDiff {
  verdict: Verdict; exitCode: number;
  tolerance: number; absMinMs: number;
  oldBuild: { label: string; version?: string }; newBuild: { label: string; version?: string };
  steps: StepDiff[];
}

function buildLabel(runDir: string): { label: string; version?: string } {
  try {
    const meta = JSON.parse(readFileSync(join(runDir, 'meta.json'), 'utf8')) as Record<string, unknown>;
    return { label: String(meta.appLabel ?? runDir), version: meta.appVersion as string | undefined };
  } catch { return { label: runDir }; }
}

/** Diff two runs of the SAME scenario, keyed by step name. Headline: timing Δ + freeze Δ per step. */
export function diffRuns(oldRunDir: string, newRunDir: string, opts?: { tolerance?: number; absMinMs?: number }): RunDiff {
  const tolerance = opts?.tolerance ?? (Number(process.env.BASELINE_TOLERANCE) || 1.2);
  // Ignore sub-50ms wobble so tiny steps don't flap the verdict on noise.
  const absMinMs = opts?.absMinMs ?? 50;
  const oldSteps = readRunSteps(oldRunDir);
  const newSteps = readRunSteps(newRunDir);
  return diffStepSets(oldSteps, newSteps, { tolerance, absMinMs, oldBuild: buildLabel(oldRunDir), newBuild: buildLabel(newRunDir) });
}

/** Diff already-reduced step sets (used by both diffRuns and the in-report baseline embed). */
export function diffStepSets(
  oldSteps: StepMetrics[], newSteps: StepMetrics[],
  ctx: { tolerance: number; absMinMs: number; oldBuild: { label: string; version?: string }; newBuild: { label: string; version?: string } },
): RunDiff {
  const { tolerance, absMinMs } = ctx;
  const oldByName = new Map(oldSteps.map((s) => [s.name, s]));
  const newByName = new Map(newSteps.map((s) => [s.name, s]));
  const names = [...new Set([...newSteps.map((s) => s.name), ...oldSteps.map((s) => s.name)])];

  const steps: StepDiff[] = names.map((name) => {
    const o = oldByName.get(name), nw = newByName.get(name);
    if (o && !nw) return blank(name, 'removed', o, undefined);
    if (!o && nw) return blank(name, 'added', undefined, nw);
    const old = o!, neu = nw!;
    const durationDeltaMs = neu.durationMs - old.durationMs;
    const durationDeltaPct = old.durationMs > 0 ? (durationDeltaMs / old.durationMs) * 100 : 0;
    const timingRegressed = neu.durationMs > old.durationMs * tolerance && durationDeltaMs >= absMinMs;
    const newFreeze = neu.froze && !old.froze;
    const freezeRegressed = newFreeze || neu.worstFreezeMs > old.worstFreezeMs * tolerance;
    const severe = freezeRegressed && neu.worstFreezeMs >= 3000;
    const notes = explain(old, neu);
    return { name, status: 'common', old, new: neu, durationDeltaMs, durationDeltaPct, timingRegressed, freezeRegressed, newFreeze, severe, notes };
  });

  // Verdict: a new/worse SEVERE freeze fails; any timing or freeze regression cautions.
  let verdict: Verdict = 'PASS';
  if (steps.some((s) => s.severe)) verdict = 'FAIL';
  else if (steps.some((s) => s.timingRegressed || s.freezeRegressed)) verdict = 'CAUTION';
  const exitCode = verdict === 'FAIL' ? 2 : verdict === 'CAUTION' ? 1 : 0;
  return { verdict, exitCode, tolerance, absMinMs, oldBuild: ctx.oldBuild, newBuild: ctx.newBuild, steps };
}

function blank(name: string, status: 'added' | 'removed', old?: StepMetrics, nw?: StepMetrics): StepDiff {
  return { name, status, old, new: nw, durationDeltaMs: 0, durationDeltaPct: 0, timingRegressed: false, freezeRegressed: status === 'added' && !!nw?.froze, newFreeze: status === 'added' && !!nw?.froze, severe: false, notes: [] };
}

// The evidence deltas that EXPLAIN a timing/freeze change (secondary to the headline numbers).
function explain(o: StepMetrics, n: StepMetrics): string[] {
  const notes: string[] = [];
  if (n.worstMainLagMs > o.worstMainLagMs + 100) notes.push(`main-loop lag ${o.worstMainLagMs}→${n.worstMainLagMs}ms`);
  if (n.worstUiGapMs > o.worstUiGapMs + 100) notes.push(`UI gap ${o.worstUiGapMs}→${n.worstUiGapMs}ms`);
  if (n.ipcMsgs > o.ipcMsgs * 1.5 && n.ipcMsgs - o.ipcMsgs > 20) notes.push(`IPC ${o.ipcMsgs}→${n.ipcMsgs} msgs`);
  if (n.ipcReplyP95Ms > o.ipcReplyP95Ms + 50) notes.push(`invoke p95 ${o.ipcReplyP95Ms}→${n.ipcReplyP95Ms}ms`);
  if (n.jsErrors > o.jsErrors) notes.push(`+${n.jsErrors - o.jsErrors} JS error(s)`);
  if (n.slowestNetMs > o.slowestNetMs + 200) notes.push(`slowest request ${o.slowestNetMs}→${n.slowestNetMs}ms`);
  const newChans = n.topIpcChannels.map((c) => c.channel).filter((c) => !o.topIpcChannels.some((x) => x.channel === c));
  if (newChans.length) notes.push(`new top IPC channel: ${newChans.join(', ')}`);
  return notes;
}

// ── rendering ─────────────────────────────────────────────────────────────────────────────────────
const stepTag = (s: StepDiff): string =>
  s.status === 'added' ? '🆕 added' : s.status === 'removed' ? '➖ removed'
    : s.severe ? '❌ severe' : s.timingRegressed && s.freezeRegressed ? '🔺 slower + froze'
    : s.timingRegressed ? '🔺 slower' : s.freezeRegressed ? '🔺 froze' : '✓';

export function renderDiffMarkdown(d: RunDiff): string {
  const L: string[] = [];
  L.push('# Electron Build Comparison — timing & freeze diff', '');
  L.push('| Field | Value |', '|-------|-------|');
  L.push(`| Old build | ${d.oldBuild.label}${d.oldBuild.version ? ` (v${d.oldBuild.version})` : ''} |`);
  L.push(`| New build | ${d.newBuild.label}${d.newBuild.version ? ` (v${d.newBuild.version})` : ''} |`);
  L.push(`| Tolerance | ${d.tolerance}× (min ${d.absMinMs}ms) |`);
  L.push(`| **Verdict** | **${VERDICT_EMOJI[d.verdict]} ${d.verdict}** |`, '');

  const regressed = d.steps.filter((s) => s.timingRegressed || s.freezeRegressed || s.severe);
  L.push('## What changed', '');
  if (regressed.length === 0) L.push('No timing or freeze regressions vs the old build. ✅', '');
  else for (const s of regressed) {
    const parts: string[] = [];
    if (s.timingRegressed) parts.push(`**${fmtSec(s.old!.durationMs)} → ${fmtSec(s.new!.durationMs)}** (${fmtPct(s.durationDeltaPct)})`);
    if (s.newFreeze) parts.push(`**new freeze** ${fmtSec(s.new!.worstFreezeMs)} [${s.new!.freezeLayers.join(', ')}]`);
    else if (s.freezeRegressed) parts.push(`**worse freeze** ${fmtSec(s.old!.worstFreezeMs)} → ${fmtSec(s.new!.worstFreezeMs)}`);
    L.push(`- **${s.name}** — ${parts.join('; ')}${s.notes.length ? `  \n  ↳ ${s.notes.join(' · ')}` : ''}`);
  }
  L.push('');

  L.push('## Per-step timing', '');
  L.push('| Step | Old | New | Δ | Freeze (old→new) | Status |', '|------|-----|-----|---|------------------|--------|');
  for (const s of d.steps) {
    if (s.status !== 'common') {
      const m = s.new ?? s.old!;
      L.push(`| ${esc(s.name)} | ${s.old ? fmtSec(s.old.durationMs) : '—'} | ${s.new ? fmtSec(s.new.durationMs) : '—'} | — | ${m.froze ? fmtSec(m.worstFreezeMs) : '—'} | ${stepTag(s)} |`);
      continue;
    }
    const fz = `${s.old!.froze ? fmtSec(s.old!.worstFreezeMs) : '—'} → ${s.new!.froze ? fmtSec(s.new!.worstFreezeMs) : '—'}`;
    L.push(`| ${esc(s.name)} | ${fmtSec(s.old!.durationMs)} | ${fmtSec(s.new!.durationMs)} | ${fmtPct(s.durationDeltaPct)} | ${fz} | ${stepTag(s)} |`);
  }
  L.push('');
  return L.join('\n');
}

// The diff as an HTML fragment (heading + verdict + table) — embeddable in the single-run report.
export function diffSectionHtml(d: RunDiff): string {
  const rows = d.steps.map((s) => {
    const old = s.old ? fmtSec(s.old.durationMs) : '—';
    const neu = s.new ? fmtSec(s.new.durationMs) : '—';
    const delta = s.status === 'common' ? fmtPct(s.durationDeltaPct) : '—';
    const fz = s.status === 'common'
      ? `${s.old!.froze ? fmtSec(s.old!.worstFreezeMs) : '—'} → ${s.new!.froze ? fmtSec(s.new!.worstFreezeMs) : '—'}`
      : (s.new ?? s.old!).froze ? fmtSec((s.new ?? s.old!).worstFreezeMs) : '—';
    const cls = s.severe ? 'sev' : (s.timingRegressed || s.freezeRegressed) ? 'reg' : '';
    const notes = s.notes.length ? `<div class="notes">${esc(s.notes.join(' · '))}</div>` : '';
    return `<tr class="${cls}"><td>${esc(s.name)}${notes}</td><td>${old}</td><td>${neu}</td><td>${delta}</td><td>${fz}</td><td>${esc(stepTag(s))}</td></tr>`;
  }).join('\n');
  return `<section class="build-diff">
  <h2>Build comparison — timing &amp; freeze diff <span class="verdict">${VERDICT_EMOJI[d.verdict]} ${d.verdict}</span></h2>
  <p>Old: <b>${esc(d.oldBuild.label)}</b>${d.oldBuild.version ? ` v${esc(d.oldBuild.version)}` : ''} → New: <b>${esc(d.newBuild.label)}</b>${d.newBuild.version ? ` v${esc(d.newBuild.version)}` : ''} · tolerance ${d.tolerance}×</p>
  <table><thead><tr><th>Step</th><th>Old</th><th>New</th><th>Δ</th><th>Freeze (old→new)</th><th>Status</th></tr></thead>
  <tbody>${rows}</tbody></table></section>`;
}

export function renderDiffHtml(d: RunDiff): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Build Comparison</title><style>
  body{font:14px/1.5 -apple-system,system-ui,sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#1a1a1a}
  h1,h2{font-size:1.3rem} table{border-collapse:collapse;width:100%;margin:1rem 0} th,td{border:1px solid #ddd;padding:.4rem .6rem;text-align:left}
  th{background:#f5f5f5} tr.reg{background:#fff7e6} tr.sev{background:#fde7e7} .verdict{font-size:1rem;font-weight:700}
  .notes{color:#888;font-size:.85em;margin-top:.2rem}</style></head><body>
  <h1>Electron Build Comparison</h1>
  ${diffSectionHtml(d)}</body></html>`;
}

/** Write the standalone compare report (md + html + result.json) into outDir. */
export function writeDiffReport(d: RunDiff, outDir: string): { mdPath: string; htmlPath: string } {
  const mdPath = join(outDir, 'compare-report.md');
  const htmlPath = join(outDir, 'compare-report.html');
  writeFileSync(mdPath, renderDiffMarkdown(d));
  writeFileSync(htmlPath, renderDiffHtml(d));
  writeFileSync(join(outDir, 'compare-result.json'), JSON.stringify({ verdict: d.verdict, exitCode: d.exitCode }, null, 2));
  return { mdPath, htmlPath };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// CLIENT-PERFORMANCE SIGN-OFF: a budget-gated comparison of two builds, by metric × (route × step).
// This is the dedicated `compare` report — verdict-first, comparison-native, no single-run timeline.
// ════════════════════════════════════════════════════════════════════════════════════════════════

function pctl(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))]);
}

// Electron client-perf metrics. All "lower is better"; budgetPct = allowed regression before the gate
// trips; floor = absolute change below which a % regression is ignored as noise.
export const PERF_METRICS = [
  { key: 'duration', label: 'Duration', unit: 'ms', budgetPct: 20, floor: 50, stepOnly: true },
  { key: 'uiGapP95', label: 'UI gap p95', unit: 'ms', budgetPct: 25, floor: 30, stepOnly: false },
  { key: 'mainLagP95', label: 'Main-lag p95', unit: 'ms', budgetPct: 25, floor: 30, stepOnly: false },
  { key: 'ipcMsgs', label: 'IPC msgs', unit: '', budgetPct: 30, floor: 50, stepOnly: false },
  { key: 'ipcInvokeP95', label: 'Invoke p95', unit: 'ms', budgetPct: 25, floor: 25, stepOnly: false },
  { key: 'peakHeapMB', label: 'Peak heap', unit: 'MB', budgetPct: 20, floor: 10, stepOnly: false },
] as const;
type MetricKey = (typeof PERF_METRICS)[number]['key'];

export interface PerfCell { key: string; metrics: Partial<Record<MetricKey, number>>; froze: boolean; worstFreezeMs: number; freezeLayers: string[] }
export interface PerfRun { build: { label: string; version?: string }; steps: PerfCell[]; routes: PerfCell[] }

function normalizeRoute(u: string): string {
  if (!u) return '/';
  const h = u.indexOf('#');
  if (h >= 0 && h < u.length - 1) return u.slice(h);           // SPA hash route, build-path independent
  const q = u.indexOf('?'); const noq = q >= 0 ? u.slice(0, q) : u;
  const segs = noq.replace(/\/+$/, '').split('/');
  return segs[segs.length - 1] || '/';                          // basename (orders.html), normalizes build dirs
}

/** Reduce a run to per-step and per-route metric cells (the route timeline attributes each event). */
export function reducePerf(runDir: string): PerfRun {
  const actions = readJsonl<ActionWindow>(join(runDir, 'actions.jsonl'));
  const hb = readJsonl<{ ts: string; gapMs: number; route?: string }>(join(runDir, 'heartbeat.jsonl'));
  const loop = readJsonl<{ ts: string; kind: string; maxLagMs?: number }>(join(runDir, 'main-loop.jsonl'));
  const ipc = readJsonl<IpcMsg>(join(runDir, 'ipc.jsonl'));
  const heap = readJsonl<{ ts: string; heapMB: number; route?: string }>(join(runDir, 'heap.jsonl'));
  const freezes = readJsonl<FreezeEvt>(join(runDir, 'freezes.jsonl'));
  const routeTl = readJsonl<{ ts: string; url: string }>(join(runDir, 'routes.jsonl'))
    .map((r) => ({ t: Date.parse(r.ts), route: normalizeRoute(r.url) })).sort((a, b) => a.t - b.t);
  const routeAt = (t: number): string => { let r = routeTl[0]?.route ?? '/'; for (const x of routeTl) { if (x.t <= t) r = x.route; else break; } return r; };

  const lagsAll = loop.filter((r) => r.kind === 'lag');
  const cell = (key: string, ms: (ts: number) => boolean, hbF: (route: string, ts: number) => boolean, dur?: number): PerfCell => {
    const gaps = hb.filter((g) => hbF(normalizeRoute(g.route ?? ''), Date.parse(g.ts))).map((g) => g.gapMs);
    const lags = lagsAll.filter((r) => ms(Date.parse(r.ts))).map((r) => r.maxLagMs ?? 0);
    const msgs = ipc.filter((m) => m.transport !== 'invoke-reply' && ms(m.t)).length;
    const inv = ipc.filter((m) => m.transport === 'invoke-reply' && m.latencyMs != null && ms(m.t)).map((m) => m.latencyMs!);
    const heaps = heap.filter((h) => hbF(normalizeRoute(h.route ?? ''), Date.parse(h.ts))).map((h) => h.heapMB);
    const fz = freezes.filter((f) => ms(Date.parse(f.startIso)));
    const metrics: Partial<Record<MetricKey, number>> = {};
    if (dur != null) metrics.duration = dur;
    if (gaps.length) metrics.uiGapP95 = pctl(gaps, 0.95);
    if (lags.length) metrics.mainLagP95 = pctl(lags, 0.95);
    metrics.ipcMsgs = msgs;
    if (inv.length) metrics.ipcInvokeP95 = pctl(inv, 0.95);
    if (heaps.length) metrics.peakHeapMB = Math.max(...heaps);
    return { key, metrics, froze: fz.length > 0, worstFreezeMs: fz.reduce((m, f) => Math.max(m, f.durationMs), 0), freezeLayers: [...new Set(fz.map((f) => f.layer))] };
  };

  // Steps: window by step time (route filter ignored — a step is a time slice).
  const seen = new Map<string, number>();
  const steps = actions.map((a) => {
    const n = (seen.get(a.name) ?? 0) + 1; seen.set(a.name, n);
    const key = n > 1 ? `${a.name} (${n})` : a.name;
    const lo = Date.parse(a.startIso), hi = Date.parse(a.endIso);
    return cell(key, (t) => t >= lo && t <= hi, (_r, t) => t >= lo && t <= hi, Math.max(0, hi - lo));
  });

  // Routes: filter by the active route (heap/heartbeat carry their own; everything else via the timeline).
  const routeKeys = [...new Set([...routeTl.map((r) => r.route), ...hb.map((g) => normalizeRoute(g.route ?? '')), ...heap.map((h) => normalizeRoute(h.route ?? ''))].filter(Boolean))];
  const routes = routeKeys.map((rk) => cell(rk, (t) => routeAt(t) === rk, (route) => route === rk));

  return { build: buildLabel(runDir), steps, routes };
}

export type Gate = 'fail' | 'caution' | 'pass';
export interface ScoreRow { dim: 'step' | 'route'; cell: string; metricKey: MetricKey; label: string; unit: string; old: number; new: number; deltaPct: number; budgetPct: number; gate: Gate; overBy: number }
export interface PerfDiff {
  verdict: Verdict; exitCode: number;
  oldBuild: { label: string; version?: string }; newBuild: { label: string; version?: string };
  rows: ScoreRow[];                              // every metric cell, regressed-first
  freezeRows: { dim: string; cell: string; oldMs: number; newMs: number; severe: boolean; layers: string[] }[];
  routeMatrix: MatrixRow[]; // route × metric
  stepMatrix: MatrixRow[];  // step × metric
}
interface MatrixRow { key: string; cells: (ScoreRow | undefined)[] }

function scoreCells(dim: 'step' | 'route', oldCells: PerfCell[], newCells: PerfCell[], budgetOverride: number): { rows: ScoreRow[]; freeze: PerfDiff['freezeRows'] } {
  const oldBy = new Map(oldCells.map((c) => [c.key, c]));
  const rows: ScoreRow[] = [];
  const freeze: PerfDiff['freezeRows'] = [];
  for (const nc of newCells) {
    const oc = oldBy.get(nc.key);
    if (!oc) continue;
    for (const def of PERF_METRICS) {
      if (def.stepOnly && dim !== 'step') continue;
      const ov = oc.metrics[def.key], nv = nc.metrics[def.key];
      if (ov == null || nv == null || ov <= 0) continue;
      const deltaPct = ((nv - ov) / ov) * 100;
      const budgetPct = budgetOverride || def.budgetPct;
      const over = deltaPct > budgetPct && nv - ov >= def.floor;
      const severe = over && nv >= ov * 2;
      rows.push({ dim, cell: nc.key, metricKey: def.key, label: def.label, unit: def.unit, old: ov, new: nv, deltaPct, budgetPct, gate: severe ? 'fail' : over ? 'caution' : 'pass', overBy: deltaPct - budgetPct });
    }
    // Freeze regression for step cells: a new freeze, or a materially worse one.
    if (dim === 'step') {
      const newFreeze = nc.froze && !oc.froze;
      const worse = nc.worstFreezeMs > oc.worstFreezeMs * 1.2;
      if (newFreeze || worse) freeze.push({ dim, cell: nc.key, oldMs: oc.worstFreezeMs, newMs: nc.worstFreezeMs, severe: nc.worstFreezeMs >= 3000, layers: nc.freezeLayers });
    }
  }
  return { rows, freeze };
}

export function comparePerf(oldRunDir: string, newRunDir: string): PerfDiff {
  const budgetOverride = Number(process.env.PERF_BUDGET_PCT) || 0;
  const oldRun = reducePerf(oldRunDir), newRun = reducePerf(newRunDir);
  const s = scoreCells('step', oldRun.steps, newRun.steps, budgetOverride);
  const r = scoreCells('route', oldRun.routes, newRun.routes, budgetOverride);
  const rows = [...s.rows, ...r.rows].sort((a, b) => b.overBy - a.overBy);
  const freezeRows = s.freeze;

  const matrix = (dim: 'step' | 'route', cells: PerfCell[]): MatrixRow[] =>
    cells.map((c) => ({ key: c.key, cells: PERF_METRICS.filter((m) => !(m.stepOnly && dim === 'route')).map((m) => rows.find((rw) => rw.dim === dim && rw.cell === c.key && rw.metricKey === m.key)) }));

  let verdict: Verdict = 'PASS';
  if (rows.some((rw) => rw.gate === 'fail') || freezeRows.some((f) => f.severe)) verdict = 'FAIL';
  else if (rows.some((rw) => rw.gate === 'caution') || freezeRows.length) verdict = 'CAUTION';
  const exitCode = verdict === 'FAIL' ? 2 : verdict === 'CAUTION' ? 1 : 0;

  return {
    verdict, exitCode, oldBuild: oldRun.build, newBuild: newRun.build, rows, freezeRows,
    routeMatrix: matrix('route', newRun.routes), stepMatrix: matrix('step', newRun.steps),
  };
}

// ── rendering the sign-off ──────────────────────────────────────────────────────────────────────────
const GATE_EMOJI: Record<Gate, string> = { fail: '❌', caution: '⚠️', pass: '✅' };
const fmtMetric = (v: number, unit: string): string => unit === 'ms' ? (v >= 1000 ? (v / 1000).toFixed(2) + 's' : Math.round(v) + 'ms') : unit ? `${Math.round(v)} ${unit}` : v.toLocaleString();

export function renderPerfMarkdown(d: PerfDiff): string {
  const regressed = d.rows.filter((r) => r.gate !== 'pass');
  const L: string[] = [];
  L.push('# Client-Performance Sign-off', '');
  L.push(`**${VERDICT_EMOJI[d.verdict]} ${d.verdict}** — \`${d.oldBuild.label}${d.oldBuild.version ? ` v${d.oldBuild.version}` : ''}\` → \`${d.newBuild.label}${d.newBuild.version ? ` v${d.newBuild.version}` : ''}\``, '');
  L.push(`${regressed.length} metric(s) over budget · ${d.freezeRows.length} freeze regression(s) · ${new Set(regressed.filter((r) => r.dim === 'route').map((r) => r.cell)).size} route(s) affected`, '');

  L.push('## Scorecard — the gate', '');
  if (regressed.length === 0 && d.freezeRows.length === 0) L.push('Every metric within budget vs the previous build. ✅', '');
  else {
    L.push('| Where | Metric | Old | New | Δ | Budget | Gate |', '|---|---|---|---|---|---|---|');
    for (const r of regressed) L.push(`| ${esc(r.cell)} | ${r.label} | ${fmtMetric(r.old, r.unit)} | ${fmtMetric(r.new, r.unit)} | ${fmtPct(r.deltaPct)} | +${r.budgetPct}% | ${GATE_EMOJI[r.gate]} |`);
    for (const f of d.freezeRows) L.push(`| ${esc(f.cell)} | Freeze | ${f.oldMs ? fmtSec(f.oldMs) : 'none'} | ${fmtSec(f.newMs)} [${f.layers.join(', ')}] | — | — | ${f.severe ? '❌' : '⚠️'} |`);
    L.push('');
  }

  L.push('## By route', '');
  L.push(renderMatrixMd(d.routeMatrix, 'route'));
  L.push('## By step', '');
  L.push(renderMatrixMd(d.stepMatrix, 'step'));
  L.push('<!--FLAMEGRAPH-MD-->', '');
  return L.join('\n');
}

function renderMatrixMd(matrix: MatrixRow[], dim: 'step' | 'route'): string {
  const metrics = PERF_METRICS.filter((m) => !(m.stepOnly && dim === 'route'));
  const L: string[] = [];
  L.push(`| ${dim} | ${metrics.map((m) => m.label).join(' | ')} |`, `|${'---|'.repeat(metrics.length + 1)}`);
  for (const row of matrix) {
    const cells = row.cells.map((c) => c ? `${GATE_EMOJI[c.gate]} ${fmtPct(c.deltaPct)}` : '—');
    L.push(`| ${esc(row.key)} | ${cells.join(' | ')} |`);
  }
  L.push('');
  return L.join('\n');
}

export function writePerfReport(d: PerfDiff, outDir: string, flamegraphHtml = '', flamegraphMd = ''): { mdPath: string; htmlPath: string } {
  const mdPath = join(outDir, 'compare-report.md');
  const htmlPath = join(outDir, 'compare-report.html');
  writeFileSync(mdPath, renderPerfMarkdown(d).replace('<!--FLAMEGRAPH-MD-->', flamegraphMd));
  writeFileSync(htmlPath, renderPerfHtml(d, flamegraphHtml));
  writeFileSync(join(outDir, 'compare-result.json'), JSON.stringify({ verdict: d.verdict, exitCode: d.exitCode }, null, 2));
  return { mdPath, htmlPath };
}

function matrixHtml(matrix: MatrixRow[], dim: 'step' | 'route'): string {
  const metrics = PERF_METRICS.filter((m) => !(m.stepOnly && dim === 'route'));
  const head = `<tr><th>${dim}</th>${metrics.map((m) => `<th>${m.label}</th>`).join('')}</tr>`;
  const body = matrix.map((row) => `<tr><td class="rk">${esc(row.key)}</td>${row.cells.map((c) => c ? `<td class="g-${c.gate}" title="${fmtMetric(c.old, c.unit)} → ${fmtMetric(c.new, c.unit)}">${fmtPct(c.deltaPct)}</td>` : '<td class="g-na">—</td>').join('')}</tr>`).join('');
  return `<table class="matrix"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

export function renderPerfHtml(d: PerfDiff, flamegraphHtml = ''): string {
  const regressed = d.rows.filter((r) => r.gate !== 'pass');
  const scoreRows = [
    ...regressed.map((r) => `<tr class="g-${r.gate}"><td>${esc(r.cell)}</td><td>${r.label}</td><td>${fmtMetric(r.old, r.unit)}</td><td><b>${fmtMetric(r.new, r.unit)}</b></td><td class="delta">${fmtPct(r.deltaPct)}</td><td>+${r.budgetPct}%</td><td>${GATE_EMOJI[r.gate]}</td></tr>`),
    ...d.freezeRows.map((f) => `<tr class="g-${f.severe ? 'fail' : 'caution'}"><td>${esc(f.cell)}</td><td>Freeze</td><td>${f.oldMs ? fmtSec(f.oldMs) : 'none'}</td><td><b>${fmtSec(f.newMs)}</b> [${esc(f.layers.join(', '))}]</td><td>—</td><td>—</td><td>${f.severe ? '❌' : '⚠️'}</td></tr>`),
  ].join('');
  const summary = `${regressed.length} metric(s) over budget · ${d.freezeRows.length} freeze regression(s) · ${new Set(regressed.filter((r) => r.dim === 'route').map((r) => r.cell)).size} route(s) affected`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Client-Performance Sign-off</title><style>
  :root{--fg:#1f2937;--muted:#6b7280;--line:#e5e7eb;--bg:#eef1f6;--card:#fff;--fail:#dc2626;--caution:#d97706;--pass:#16a34a;--accent:#2563eb}
  *{box-sizing:border-box}body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;margin:0;background:var(--bg);color:var(--fg);line-height:1.5}
  .wrap{max-width:1080px;margin:0 auto;padding:24px}
  .banner{border-radius:14px;padding:20px 24px;color:#fff;margin-bottom:20px;box-shadow:0 4px 16px rgba(0,0,0,.1)}
  .banner .tag{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;opacity:.85;font-weight:700}
  .banner h1{margin:.2rem 0 0;font-size:1.5rem;letter-spacing:-.01em}.banner p{margin:.4rem 0 0;opacity:.95}
  .banner.PASS{background:linear-gradient(135deg,#16a34a,#15803d)}.banner.CAUTION{background:linear-gradient(135deg,#f59e0b,#d97706)}.banner.FAIL{background:linear-gradient(135deg,#ef4444,#b91c1c)}
  .builds{font-size:.9rem;opacity:.95;margin-top:.3rem}.builds code{background:rgba(255,255,255,.2);padding:1px 7px;border-radius:5px}
  h2{font-size:.78rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:28px 0 10px;border-bottom:1px solid var(--line);padding-bottom:6px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:0 1px 2px rgba(0,0,0,.04);overflow:hidden}
  table{border-collapse:collapse;width:100%;font-size:.86rem}
  th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--line)}
  th{background:#f8fafc;color:var(--muted);font-weight:600;font-size:.76rem;text-transform:uppercase;letter-spacing:.03em}
  .delta{font-weight:700;font-variant-numeric:tabular-nums}
  tr.g-fail{background:#fef2f2}tr.g-caution{background:#fffbeb}
  .matrix td{text-align:center;font-weight:700;font-variant-numeric:tabular-nums}
  .matrix td.rk{text-align:left;font-weight:600;color:var(--fg)}
  .matrix td.g-fail{background:#fde7e7;color:#b91c1c}.matrix td.g-caution{background:#fff3d6;color:#92400e}.matrix td.g-pass{background:#eafaf0;color:#15803d}.matrix td.g-na{color:#cbd5e1}
  .ok{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:24px;text-align:center;color:var(--pass);font-weight:600}
  .legend{font-size:.78rem;color:var(--muted);margin:6px 0 0}
</style></head><body><div class="wrap">
  <div class="banner ${d.verdict}">
    <span class="tag">Client-Performance Sign-off</span>
    <h1>${VERDICT_EMOJI[d.verdict]} ${d.verdict}</h1>
    <div class="builds">previous <code>${esc(d.oldBuild.label)}${d.oldBuild.version ? ` v${esc(d.oldBuild.version)}` : ''}</code> → candidate <code>${esc(d.newBuild.label)}${d.newBuild.version ? ` v${esc(d.newBuild.version)}` : ''}</code></div>
    <p>${summary}</p>
  </div>
  <h2>Scorecard — the gate</h2>
  ${scoreRows ? `<div class="card"><table><thead><tr><th>Where</th><th>Metric</th><th>Previous</th><th>Candidate</th><th>Δ</th><th>Budget</th><th>Gate</th></tr></thead><tbody>${scoreRows}</tbody></table></div>` : '<div class="ok">✅ Every metric within budget vs the previous build.</div>'}
  <h2>By route — which screen regressed</h2>
  <div class="card">${matrixHtml(d.routeMatrix, 'route')}</div>
  <p class="legend">Δ vs previous build · 🟥 over budget (fail) · 🟧 over budget (caution) · 🟩 within budget</p>
  <h2>By step — which interaction regressed</h2>
  <div class="card">${matrixHtml(d.stepMatrix, 'step')}</div>
  ${flamegraphHtml}
</div></body></html>`;
}

// ── CLI: compare <oldRunDir> <newRunDir> [outDir] ───────────────────────────────────────────────────
const isMain = process.argv[1] && /compare\.[tj]s$/.test(process.argv[1]);
if (isMain) {
  const [oldDir, newDir, outDir] = process.argv.slice(2);
  if (!oldDir || !newDir) {
    console.error('usage: compare <oldRunDir> <newRunDir> [outDir]');
    process.exit(2);
  }
  void (async () => {
    const d = comparePerf(oldDir, newDir);
    let flameHtml = '', flameMd = '';
    try {
      const { diffFlamegraph, renderFlameHtml, renderFlameMarkdown } = await import('./flamegraph.js');
      const fd = diffFlamegraph(join(oldDir, 'trace.json'), join(newDir, 'trace.json'));
      if (fd) { flameHtml = renderFlameHtml(fd); flameMd = renderFlameMarkdown(fd); }
    } catch (e) { void e; }
    const { mdPath, htmlPath } = writePerfReport(d, outDir || newDir, flameHtml, flameMd);
    console.log(renderPerfMarkdown(d).replace('<!--FLAMEGRAPH-MD-->', flameMd));
    console.log(`\nReports: ${mdPath}\n         ${htmlPath}`);
    console.log(`Verdict: ${d.verdict} (exit ${d.exitCode})`);
    process.exit(d.exitCode);
  })();
}
