import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { severityFor, type FreezeEvent, type FreezeLayer, type Severity } from './freezeBus.js';
import type { ActionWindow } from './currentAction.js';
import { correlate } from './correlator.js';

// Reads the JSONL evidence streams a run produced, merges overlapping detector events into
// freeze "incidents", attributes each to a UI action, computes the verdict + exit code
// (mirrors process-watchdog/ReportWriter.cs) and writes the Markdown sign-off + HTML report.

interface MetricSample { ts: string; samples: { pid: number; type: string; cpu: number; mem: number }[] }

export interface Incident {
  startIso: string; endIso: string; durationMs: number;
  layers: FreezeLayer[]; severity: Severity; peakCpuPct: number; peakCpuProc: string;
  action: string; events: FreezeEvent[];
}

export interface ReportMeta {
  sessionStartIso: string; sessionEndIso: string;
  appLabel: string; launchMode: string; thresholdMs: number; loafSupported: boolean;
  mainLayers: boolean;
}

export interface ReportResult {
  verdict: 'PASS' | 'CAUTION' | 'FAIL'; exitCode: number;
  mdPath: string; htmlPath: string; incidents: Incident[];
}

const SEV_RANK: Record<Severity, number> = { MINOR: 0, MODERATE: 1, SEVERE: 2 };

// Plain-English meaning of each detection layer, used everywhere instead of internal names.
const LAYER_INFO: Record<FreezeLayer, { label: string; what: string; fix: string }> = {
  'renderer-heartbeat': {
    label: 'UI thread froze',
    what: 'The window’s main thread stopped responding — JavaScript (or layout/paint) blocked the page so clicks and rendering stalled.',
    fix: 'Find the long task (script below / trace.json) and move heavy work off the main thread — a Web Worker, or break it into smaller chunks.',
  },
  'renderer-task': {
    label: 'Long JavaScript task',
    what: 'A single JavaScript task ran far past one frame, blocking input and rendering.',
    fix: 'Optimize or split the function shown below; defer non-urgent work (requestIdleCallback / setTimeout / batching).',
  },
  'main-loop': {
    label: 'Main process blocked',
    what: 'The Electron main (Node) event loop stalled — this freezes every window and all IPC at once.',
    fix: 'Remove synchronous work from the main process: no blocking I/O or heavy compute in IPC handlers; avoid sendSync into slow handlers.',
  },
  hardware: {
    label: 'Resource pressure',
    what: 'A process hit sustained high CPU or fast memory growth.',
    fix: 'Profile the hot process; check for leaks (retained references) or runaway loops.',
  },
  native: {
    label: 'Unresponsive / crash',
    what: 'Chromium flagged the window unresponsive, or a process crashed.',
    fix: 'Check the crash reason below and correlate with the freeze immediately before it.',
  },
  ipc: {
    label: 'IPC flood',
    what: 'The renderer sent IPC messages faster than the main process could drain them (backpressure) — the queue could not flush.',
    fix: 'Batch or throttle ipcRenderer.send; coalesce per-event chatter into fewer, larger messages.',
  },
  'js-error': {
    label: 'JavaScript error',
    what: 'Code threw an uncaught exception / unhandled rejection (or logged an error). The app may be in a broken state even though it did not freeze or crash.',
    fix: 'Read the message + stack below and fix the throw. A preload throw means your exposed API never loaded — check the preload and contextBridge wiring.',
  },
  stall: {
    label: 'Stuck operation (spinner)',
    what: 'An async operation never completed while the app kept running and CPU stayed idle — the classic “spinner that never resolves”: a hung request, an IPC reply that never came, or a stuck page load.',
    fix: 'Add a timeout / AbortController to the request or IPC call below; make sure every handler eventually resolves or rejects.',
  },
  storage: {
    label: 'Storage / disk pressure',
    what: 'Storage usage approached its quota, disk space ran low, or disk I/O was slow — any of which can stall or crash the app.',
    fix: 'Prune storage and handle QuotaExceededError; make sure the userData volume has free space and is not a slow/locked (network/AV-scanned) drive.',
  },
  subprocess: {
    label: 'Subprocess problem',
    what: 'A child process the app spawned hung past its expected time or exited abnormally — the feature waiting on it can freeze.',
    fix: 'See the command + pid below: add a timeout/kill, drain stdout/stderr to avoid a pipe-buffer deadlock, and handle non-zero exits.',
  },
  deep: { label: 'Deep trace', what: '', fix: '' },
};

// Which layer best explains an incident (most actionable first).
const PRIMARY_ORDER: FreezeLayer[] = ['native', 'main-loop', 'ipc', 'renderer-task', 'renderer-heartbeat', 'hardware'];
function primaryLayer(inc: Incident): FreezeLayer {
  for (const l of PRIMARY_ORDER) if (inc.layers.includes(l)) return l;
  return inc.layers[0] ?? 'renderer-heartbeat';
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
}

// Synchronous freeze/crash layers describe ONE freeze and merge together; the async/advisory layers
// (stall, js-error, storage, subprocess) are different kinds of signal and must NOT be swallowed into
// a freeze just because their (often long) window overlaps it — each merges only with its own kind.
const FREEZE_GROUP = new Set<FreezeLayer>(['renderer-heartbeat', 'renderer-task', 'main-loop', 'hardware', 'native', 'ipc']);
const groupOf = (l: FreezeLayer): string => (FREEZE_GROUP.has(l) ? 'freeze' : l);

/** Merge detector events whose time windows overlap (within gapMs) into single incidents, per group. */
export function mergeIncidents(freezes: FreezeEvent[], gapMs = 500): Incident[] {
  const groups = new Map<string, FreezeEvent[]>();
  for (const f of freezes) {
    const g = groupOf(f.layer);
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(f);
  }
  const incidents: Incident[] = [];
  for (const evs of groups.values()) {
    const sorted = evs.sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso));
    let cur: Incident | undefined;
    for (const f of sorted) {
      const start = Date.parse(f.startIso);
      const end = start + f.durationMs;
      const curEnd = cur ? Date.parse(cur.endIso) : -Infinity;
      if (cur && start <= curEnd + gapMs) {
        if (end > curEnd) cur.endIso = new Date(end).toISOString();
        cur.durationMs = Date.parse(cur.endIso) - Date.parse(cur.startIso);
        if (!cur.layers.includes(f.layer)) cur.layers.push(f.layer);
        cur.events.push(f);
        if (cur.action === '(idle / between steps)' && f.action) cur.action = f.action;
      } else {
        cur = {
          startIso: f.startIso, endIso: new Date(end).toISOString(), durationMs: f.durationMs,
          layers: [f.layer], severity: f.severity, peakCpuPct: 0, peakCpuProc: '',
          action: f.action ?? '(idle / between steps)', events: [f],
        };
        incidents.push(cur);
      }
    }
  }
  incidents.sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso));
  for (const inc of incidents) {
    const bySpan = severityFor(inc.durationMs);
    const byEvent = inc.events.reduce<Severity>((a, e) => (SEV_RANK[e.severity] > SEV_RANK[a] ? e.severity : a), 'MINOR');
    inc.severity = SEV_RANK[bySpan] >= SEV_RANK[byEvent] ? bySpan : byEvent;
  }
  return incidents;
}

function peakCpu(inc: Incident, metrics: MetricSample[]): { pct: number; proc: string } {
  const lo = Date.parse(inc.startIso) - 500;
  const hi = Date.parse(inc.endIso) + 500;
  let pct = 0, proc = '';
  for (const m of metrics) {
    const t = Date.parse(m.ts);
    if (t < lo || t > hi) continue;
    for (const s of m.samples ?? []) if (s.cpu > pct) { pct = s.cpu; proc = s.type; }
  }
  return { pct: +pct.toFixed(1), proc };
}

// Freeze/crash-class layers gate the sign-off. Advisory layers (js-error, storage, subprocess) are
// surfaced in the report but only escalate the verdict when SEVERE (a crash, disk-full, or a crashed
// child) — so a routine console.error or a near-quota warning doesn't flip a clean run.
const GATING_LAYERS: FreezeLayer[] = ['renderer-heartbeat', 'renderer-task', 'main-loop', 'hardware', 'native', 'ipc', 'stall'];
function verdictOf(incidents: Incident[]): { verdict: ReportResult['verdict']; exitCode: number } {
  if (incidents.length === 0) return { verdict: 'PASS', exitCode: 0 };
  if (incidents.some((i) => i.severity === 'SEVERE')) return { verdict: 'FAIL', exitCode: 2 };
  if (incidents.some((i) => i.layers.some((l) => GATING_LAYERS.includes(l)))) return { verdict: 'CAUTION', exitCode: 1 };
  return { verdict: 'PASS', exitCode: 0 };
}

// ── formatting helpers ───────────────────────────────────────────────────────────────────────────
const fmtSec = (ms: number) => (ms / 1000).toFixed(3) + 's';
const fmtS1 = (ms: number) => (ms / 1000).toFixed(1) + 's';
const hhmmss = (iso: string) => new Date(iso).toTimeString().slice(0, 8);
function fmtDur(ms: number): string {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60);
  if (h >= 1) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m >= 1) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
function fmtMB(kb: number): string {
  const mb = kb / 1024;
  return mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB' : Math.round(mb) + ' MB';
}
const VERDICT_EMOJI = { PASS: '✅', CAUTION: '⚠️', FAIL: '❌' } as const;
const check = (ok: boolean) => (ok ? '✅' : '❌');
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
function stamp(iso: string): string {
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

interface Script { sourceURL: string; functionName: string; charPos: number; duration: number }
function topScript(inc: Incident): Script | undefined {
  const all: Script[] = [];
  for (const e of inc.events) {
    const s = (e.detail as { scripts?: Script[] }).scripts;
    if (Array.isArray(s)) all.push(...s);
  }
  return all.sort((a, b) => b.duration - a.duration)[0];
}

// One human-readable "where" line for a single detector event.
function evidenceLine(e: FreezeEvent): string {
  const d = e.detail as Record<string, unknown>;
  switch (e.layer) {
    case 'renderer-task': {
      const scripts = Array.isArray(d.scripts) ? (d.scripts as Script[]) : [];
      if (scripts.length) {
        const s = [...scripts].sort((a, b) => b.duration - a.duration)[0];
        return `blocked ${e.durationMs}ms — ${s.sourceURL || '(inline script)'} → ${s.functionName || '(anonymous)'} (offset ${s.charPos}, ${Math.round(s.duration)}ms)`;
      }
      return `blocked ${e.durationMs}ms (${String(d.kind ?? 'long task')})`;
    }
    case 'renderer-heartbeat': return `UI thread unresponsive for ${e.durationMs}ms`;
    case 'main-loop': return `main event loop stalled ${String(d.maxLagMs ?? e.durationMs)}ms`;
    case 'hardware':
      if (d.kind === 'memory-balloon') return `memory grew ${String(d.ratio)}× (now ${fmtMB(Number(d.currentKB))})`;
      if (d.kind === 'sustained-cpu') return `CPU ${String(d.cpuPct)}% sustained on the ${String(d.process)} process`;
      return 'resource pressure';
    case 'native': {
      if (d.kind === 'main-process-gone') return `MAIN process exited unexpectedly (code ${String(d.code)}${d.signal ? `, ${String(d.signal)}` : ''}) — the whole app went down`;
      const det = d.details as { reason?: string; exitCode?: number } | undefined;
      const reason = det?.reason ? ` — reason: ${det.reason}${det.exitCode != null ? ` (exit ${det.exitCode})` : ''}` : '';
      return `${String(d.kind)}${reason}`;
    }
    case 'ipc': return `${String(d.msgs)} IPC messages in one interval (~${String(d.ratePerSec)}/s)`;
    case 'js-error': return `${String(d.kind)}${d.where ? ` [${String(d.where)}]` : ''}: ${String(d.message ?? '')}`;
    case 'stall': return `${String(d.kind ?? 'operation')} stuck ${Math.round(Number(d.ageMs ?? e.durationMs) / 1000)}s${d.target ? ` — ${String(d.target)}` : ''}`;
    case 'storage':
      if (d.kind === 'storage-pressure') return `storage at ${String(d.pct)}% of quota (${fmtMB(Number(d.usageKB))} / ${fmtMB(Number(d.quotaKB))})`;
      if (d.kind === 'disk-low') return `disk low: ${fmtMB(Number(d.freeKB))} free on the userData volume`;
      if (d.kind === 'slow-disk') return `slow disk: ${String(d.ms)}ms for a tiny write to userData`;
      return 'storage/disk pressure';
    case 'subprocess':
      if (d.kind === 'subprocess-hung') return `child still running after ${Math.round(Number(d.ageMs) / 1000)}s: ${String(d.cmd)} (pid ${String(d.pid)})`;
      if (d.kind === 'subprocess-crashed') return `child exited abnormally: ${String(d.cmd)} (code ${String(d.code)}${d.signal ? `, ${String(d.signal)}` : ''})`;
      return 'subprocess problem';
    default: return `${e.durationMs}ms`;
  }
}

// The single most useful "root cause" pointer for an incident.
function culprit(inc: Incident): string {
  const s = topScript(inc);
  if (s) return `${s.sourceURL || '(inline script)'} → ${s.functionName || '(anonymous)'} (offset ${s.charPos})`;
  const p = primaryLayer(inc);
  const ev = inc.events.find((e) => e.layer === p) ?? inc.events[0];
  return ev ? evidenceLine(ev) : '—';
}

// Report CPU factually — DON'T infer deadlock-vs-compute from it. getAppMetrics percentCPUUsage is
// coarse and a blocked process often can't be sampled mid-freeze, so it routinely reads low even for
// a busy loop. The layer + root-cause script + trace.json are the reliable signals.
function cpuNote(inc: Incident, mainLayers: boolean): string {
  if (!mainLayers) return 'not captured in this mode — attach with `--inspect` to sample per-process CPU/memory';
  const proc = inc.peakCpuProc || 'unknown';
  const base = inc.peakCpuPct > 0
    ? `peak ${inc.peakCpuPct}% on the ${proc} process`
    : 'near 0% (a blocked process often can’t be sampled mid-freeze — treat as approximate)';
  return `${base} — getAppMetrics CPU% is coarse; use trace.json for the real hot path`;
}

/** Read a run's evidence and write report.md + report.html. Returns verdict + exit code for CI. */
export function buildReport(runDir: string, meta: ReportMeta): ReportResult {
  const rawFreezes = readJsonl<FreezeEvent>(join(runDir, 'freezes.jsonl'));
  const actions = readJsonl<ActionWindow>(join(runDir, 'actions.jsonl'));
  const metrics = readJsonl<MetricSample>(join(runDir, 'metrics.jsonl'));

  const correlated = correlate(rawFreezes, actions);
  const incidents = mergeIncidents(correlated);
  for (const inc of incidents) { const pc = peakCpu(inc, metrics); inc.peakCpuPct = pc.pct; inc.peakCpuProc = pc.proc; }

  const { verdict, exitCode } = verdictOf(incidents);
  const longest = incidents.reduce((a, i) => Math.max(a, i.durationMs), 0);
  const total = incidents.reduce((a, i) => a + i.durationMs, 0);
  const avg = incidents.length ? total / incidents.length : 0;

  const artifacts = {
    video: existsSync(join(runDir, 'video.webm')),
    trace: existsSync(join(runDir, 'trace.json')),
  };
  const md = renderMarkdown({ meta, incidents, verdict, longest, total, avg, rawFreezes, artifacts });
  const html = renderHtml({ meta, incidents, verdict, longest, total, artifacts });

  const base = `electron-freeze-report-${stamp(meta.sessionStartIso)}`;
  const mdPath = join(runDir, `${base}.md`);
  const htmlPath = join(runDir, 'report.html');
  writeFileSync(mdPath, md);
  writeFileSync(htmlPath, html);
  return { verdict, exitCode, mdPath, htmlPath, incidents };
}

function renderMarkdown(a: {
  meta: ReportMeta; incidents: Incident[]; verdict: ReportResult['verdict'];
  longest: number; total: number; avg: number; rawFreezes: FreezeEvent[];
  artifacts: { video: boolean; trace: boolean };
}): string {
  const { meta, incidents, verdict } = a;
  const start = new Date(meta.sessionStartIso), end = new Date(meta.sessionEndIso);
  const L: string[] = [];
  L.push('# Electron Freeze Watchdog — Sign-off Report', '');
  L.push('| Field | Value |', '|-------|-------|');
  L.push(`| Date | ${meta.sessionStartIso.slice(0, 10)} |`);
  L.push(`| Session | ${start.toTimeString().slice(0, 8)} → ${end.toTimeString().slice(0, 8)} (${fmtDur(end.getTime() - start.getTime())}) |`);
  L.push(`| App | ${meta.appLabel} |`);
  L.push(`| Launch Mode | ${meta.launchMode}${meta.mainLayers ? '' : ' (main-process layers L3/L4/L5/L7 unavailable)'} |`);
  L.push(`| Main-process layers | ${meta.mainLayers ? 'available' : 'unavailable (plain cdp — add --inspect)'} |`);
  L.push(`| Freeze Threshold | ${meta.thresholdMs}ms |`);
  L.push(`| **Verdict** | **${VERDICT_EMOJI[verdict]} ${verdict}** |`, '');

  if (incidents.length === 0) {
    L.push('## Result', '', 'No freezes detected during the session. 🎉', '');
  } else {
    L.push('## Freezes at a glance', '');
    L.push('| # | When | Triggered by | What froze | Duration | Severity |');
    L.push('|---|------|--------------|-----------|----------|----------|');
    incidents.forEach((i, n) => {
      L.push(`| ${n + 1} | ${hhmmss(i.startIso)} | ${i.action} | ${LAYER_INFO[primaryLayer(i)].label} | ${fmtS1(i.durationMs)} | ${i.severity} |`);
    });
    L.push('');

    L.push('## Diagnosis', '');
    incidents.forEach((i, n) => {
      const p = primaryLayer(i);
      L.push(`### #${n + 1} · ${LAYER_INFO[p].label} · ${fmtS1(i.durationMs)} (${i.severity})`, '');
      L.push(`- **Triggered by:** ${i.action}`);
      L.push(`- **Where (root cause):** ${culprit(i)}`);
      L.push(`- **What happened:** ${LAYER_INFO[p].what}`);
      L.push(`- **CPU:** ${cpuNote(i, meta.mainLayers)}`);
      L.push(`- **Next step:** ${LAYER_INFO[p].fix}`);
      const others = i.events.map((e) => `${LAYER_INFO[e.layer].label}: ${evidenceLine(e)}`);
      L.push(`- **Signals:** ${[...new Set(others)].join('; ')}`, '');
    });

    L.push('## Summary', '');
    L.push(`- **Freezes:** ${incidents.length} · **worst:** ${fmtS1(a.longest)} · **total frozen:** ${fmtS1(a.total)} · **average:** ${fmtS1(a.avg)}`);
    const byLayer = a.rawFreezes.reduce<Record<string, number>>((m, e) => ((m[LAYER_INFO[e.layer].label] = (m[LAYER_INFO[e.layer].label] ?? 0) + 1), m), {});
    L.push(`- **Signals seen:** ${Object.entries(byLayer).map(([k, v]) => `${k} (${v})`).join(', ') || 'none'}`, '');
  }

  L.push('## Sign-off Criteria', '');
  L.push('| Criterion | Threshold | Result |', '|-----------|-----------|--------|');
  L.push(`| No freezes | 0 | ${check(incidents.length === 0)} ${incidents.length} |`);
  L.push(`| Longest freeze < 3s | < 3s | ${check(a.longest < 3000)} ${fmtSec(a.longest)} |`);
  L.push(`| Total freeze time < 10s | < 10s | ${check(a.total < 10000)} ${fmtSec(a.total)} |`, '');

  L.push('## Artifacts', '');
  L.push('- `report.html` — visual report (open in a browser)');
  if (a.artifacts.video) L.push('- `video.webm` — screen recording of the run');
  if (a.artifacts.trace) L.push('- `trace.json` — Chromium trace with CPU samples → load in `chrome://tracing`, Perfetto, or DevTools → Performance (import). The exact hung call stack is here, at the freeze timestamps above.');
  L.push('- Raw evidence: `freezes.jsonl`, `metrics.jsonl`, `actions.jsonl`, `renderer-tasks.jsonl`, `ipc.jsonl`', '');
  L.push('---', `*Generated by electron-monitoring on ${meta.sessionStartIso.replace('T', ' ').slice(0, 19)}*`, '');
  return L.join('\n');
}

function renderHtml(a: {
  meta: ReportMeta; incidents: Incident[]; verdict: ReportResult['verdict'];
  longest: number; total: number; artifacts: { video: boolean; trace: boolean };
}): string {
  const { meta, incidents, verdict } = a;
  const sevClass = (s: Severity) => `sev-${s.toLowerCase()}`;
  const barMax = Math.max(a.longest, 1);

  const timelineRows = incidents.map((i, n) => {
    const w = Math.max(6, Math.round((i.durationMs / barMax) * 100));
    return `<a class="tl-row" href="#inc${n}">
      <span class="tl-time">${hhmmss(i.startIso)}</span>
      <span class="tl-act" title="${esc(i.action)}">${esc(i.action)}</span>
      <span class="tl-track"><span class="tl-fill ${sevClass(i.severity)}" style="width:${w}%"></span></span>
      <span class="tl-dur">${fmtS1(i.durationMs)} <em>${i.severity}</em></span>
    </a>`;
  }).join('');

  const cards = incidents.map((i, n) => {
    const p = primaryLayer(i);
    const chips = [...new Set(i.layers)].map((l) => `<span class="chip">${esc(LAYER_INFO[l].label)}</span>`).join('');
    const signals = i.events.map((e) => `<li><b>${esc(LAYER_INFO[e.layer].label)}</b> — ${esc(evidenceLine(e))}</li>`).join('');
    const deep = a.artifacts.trace
      ? `<div class="kv"><span>Dig deeper</span><div><code>trace.json</code> at <b>${hhmmss(i.startIso)}</b> → open in chrome://tracing / DevTools Performance for the exact call stack</div></div>`
      : '';
    return `<section id="inc${n}" class="card ${sevClass(i.severity)}">
      <h3><span class="num">#${n + 1}</span> ${esc(LAYER_INFO[p].label)} · ${fmtS1(i.durationMs)} <span class="badge ${sevClass(i.severity)}">${i.severity}</span></h3>
      <div class="kv"><span>Triggered by</span><div><b>${esc(i.action)}</b> at ${hhmmss(i.startIso)}</div></div>
      <div class="kv"><span>Root cause</span><div class="cause">${esc(culprit(i))}</div></div>
      <div class="kv"><span>What happened</span><div>${esc(LAYER_INFO[p].what)}</div></div>
      <div class="kv"><span>CPU</span><div>${esc(cpuNote(i, meta.mainLayers))}</div></div>
      <div class="kv"><span>Next step</span><div class="fix">${esc(LAYER_INFO[p].fix)}</div></div>
      <div class="kv"><span>Signals</span><div>${chips}<ul class="sig">${signals}</ul></div></div>
      ${deep}
    </section>`;
  }).join('');

  const artLinks = [
    a.artifacts.video ? '<a href="video.webm">🎬 video.webm</a>' : '',
    a.artifacts.trace ? '<a href="trace.json">🔬 trace.json (chrome://tracing — call stacks)</a>' : '',
    '<a href="freezes.jsonl">freezes.jsonl</a>',
    '<a href="metrics.jsonl">metrics.jsonl</a>',
    '<a href="renderer-tasks.jsonl">renderer-tasks.jsonl</a>',
  ].filter(Boolean).join(' · ');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Electron Freeze Report</title><style>
  :root{--fg:#1f2937;--muted:#6b7280;--line:#e5e7eb;--bg:#f7f8fa;--card:#fff;
        --sev:#dc2626;--mod:#d97706;--min:#6b7280;--ok:#16a34a;--accent:#2563eb}
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:var(--bg);color:var(--fg);line-height:1.5}
  .wrap{max-width:920px;margin:0 auto;padding:24px}
  .banner{border-radius:12px;padding:18px 22px;color:#fff;margin-bottom:18px}
  .banner h1{margin:0;font-size:1.35rem}.banner p{margin:.3rem 0 0;opacity:.95;font-size:.95rem}
  .banner.PASS{background:var(--ok)}.banner.CAUTION{background:var(--mod)}.banner.FAIL{background:var(--sev)}
  .meta{display:flex;flex-wrap:wrap;gap:8px 20px;font-size:.85rem;color:var(--muted);margin-bottom:22px}
  .meta b{color:var(--fg);font-weight:600}
  h2{font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:26px 0 10px;border-bottom:1px solid var(--line);padding-bottom:6px}
  /* timeline */
  .tl-row{display:flex;align-items:center;gap:12px;padding:7px 8px;border-radius:8px;text-decoration:none;color:inherit}
  .tl-row:hover{background:#eef2ff}
  .tl-time{font-variant-numeric:tabular-nums;color:var(--muted);font-size:.82rem;width:64px;flex:none}
  .tl-act{width:180px;flex:none;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tl-track{flex:1;height:18px;background:#edf0f4;border-radius:9px;overflow:hidden}
  .tl-fill{display:block;height:100%;border-radius:9px}
  .tl-fill.sev-severe{background:var(--sev)}.tl-fill.sev-moderate{background:var(--mod)}.tl-fill.sev-minor{background:var(--min)}
  .tl-dur{width:118px;flex:none;text-align:right;font-variant-numeric:tabular-nums;font-weight:700}
  .tl-dur em{font-style:normal;font-weight:600;font-size:.72rem;color:var(--muted);display:block}
  /* cards */
  .card{background:var(--card);border:1px solid var(--line);border-left:5px solid var(--min);border-radius:12px;padding:16px 18px;margin:12px 0;box-shadow:0 1px 2px rgba(0,0,0,.04)}
  .card.sev-severe{border-left-color:var(--sev)}.card.sev-moderate{border-left-color:var(--mod)}.card.sev-minor{border-left-color:var(--min)}
  .card h3{margin:0 0 12px;font-size:1.08rem;display:flex;align-items:center;gap:8px}
  .num{color:var(--muted);font-weight:700}
  .badge{margin-left:auto;font-size:.7rem;font-weight:700;color:#fff;padding:2px 8px;border-radius:999px}
  .badge.sev-severe{background:var(--sev)}.badge.sev-moderate{background:var(--mod)}.badge.sev-minor{background:var(--min)}
  .kv{display:grid;grid-template-columns:120px 1fr;gap:10px;padding:5px 0;font-size:.92rem}
  .kv>span{color:var(--muted);font-weight:600}
  .cause{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#f3f4f6;border:1px solid var(--line);border-radius:6px;padding:4px 8px;font-size:.85rem;word-break:break-all}
  .fix{color:#1e40af}
  .chip{display:inline-block;background:#eef2ff;color:#3730a3;border:1px solid #e0e7ff;border-radius:999px;padding:1px 9px;font-size:.74rem;margin:0 4px 4px 0}
  ul.sig{margin:6px 0 0;padding-left:18px;font-size:.85rem;color:#374151}
  ul.sig code{font-size:.8rem}
  .arts{font-size:.88rem}.arts a{color:var(--accent);text-decoration:none;margin-right:4px}
  .empty{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:28px;text-align:center;color:var(--muted)}
  @media print{body{background:#fff}.tl-row:hover{background:none}.card{box-shadow:none}}
</style></head><body><div class="wrap">
  <div class="banner ${verdict}">
    <h1>${VERDICT_EMOJI[verdict]} ${verdict} — ${incidents.length === 0 ? 'no freezes detected' : `${incidents.length} freeze${incidents.length > 1 ? 's' : ''}, worst ${fmtS1(a.longest)}`}</h1>
    <p>${incidents.length === 0 ? 'The app stayed responsive for the whole session.' : `Total time frozen: ${fmtS1(a.total)}. Tap a row or card to jump to the cause.`}</p>
  </div>
  <div class="meta">
    <span><b>App:</b> ${esc(meta.appLabel)}</span>
    <span><b>Mode:</b> ${esc(meta.launchMode)}${meta.mainLayers ? '' : ' (renderer only — add --inspect for main-process layers)'}</span>
    <span><b>When:</b> ${hhmmss(meta.sessionStartIso)}–${hhmmss(meta.sessionEndIso)}</span>
    <span><b>Threshold:</b> ${meta.thresholdMs}ms</span>
  </div>
  ${incidents.length === 0 ? '<div class="empty">🎉 Nothing froze. Nice.</div>' : `
  <h2>Timeline — which action froze, and for how long</h2>
  <div class="timeline">${timelineRows}</div>
  <h2>What froze &amp; how to fix it</h2>
  ${cards}`}
  <h2>Artifacts</h2>
  <p class="arts">${artLinks}</p>
</div></body></html>`;
}
