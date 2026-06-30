import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { severityFor, type FreezeEvent, type FreezeLayer, type Severity } from './freezeBus.js';
import type { ActionWindow } from './currentAction.js';
import { correlate } from './correlator.js';
import { resolveLoc } from './util/sourcemap.js';
import { readRunSteps, diffStepSets, summarizeRun, diffSectionHtml, renderDiffMarkdown, type RunDiff, type RunSummary, type StepMetrics } from './compare.js';
import { readEvidenceSummary, fmtKB, type EvidenceSummary } from './evidence.js';

// Reads the JSONL evidence streams a run produced, merges overlapping detector events into
// freeze "incidents", attributes each to a UI action, computes the verdict + exit code
// (mirrors process-watchdog/ReportWriter.cs) and writes the Markdown sign-off + HTML report.

interface MetricSample { ts: string; samples: { pid: number; type: string; cpu: number; mem: number; name?: string; peakMem?: number; wakeups?: number }[] }
interface Breadcrumb { ts: string; where: string; level: string; text: string }

export interface Incident {
  startIso: string; endIso: string; durationMs: number;
  layers: FreezeLayer[]; severity: Severity; peakCpuPct: number; peakCpuProc: string;
  action: string; events: FreezeEvent[]; breadcrumbs?: Breadcrumb[];
  // Ranking (filled in buildReport): how confident we are this is a real bug, and whether it's noise.
  confidence?: number; confidenceReasons?: string[]; noise?: boolean;
  // Baseline comparison (filled when a baseline is loaded): is this freeze new/worse/within the
  // known-good run? This is what makes the verdict app-relative instead of a static absolute.
  vsBaseline?: 'new' | 'worse' | 'within'; baselineWorstMs?: number;
}

export interface ReportMeta {
  sessionStartIso: string; sessionEndIso: string;
  appLabel: string; launchMode: string; thresholdMs: number; loafSupported: boolean;
  mainLayers: boolean;
  hostUptimeSec?: number; // seconds since the host last booted — run context, never gated on
  appVersion?: string;    // the build's version (from app.getVersion()) — names which build this run is
}

// ponytail: 14d — long enough that environmental degradation is plausible; bump if your CI reboots
// rarely. Only surfaces a note when freezes ALSO occurred (uptime alone never fails a green run).
const HIGH_UPTIME_SEC = 14 * 24 * 3600;

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

// The app's own log lines leading into a freeze: the most recent `n` breadcrumbs in
// [start - lookbackMs, end]. This is the app-domain context a freeze probe can't infer.
export function breadcrumbsFor(
  startMs: number, endMs: number, all: Breadcrumb[], n = 6, lookbackMs = 30_000,
): Breadcrumb[] {
  const lo = startMs - lookbackMs;
  return all
    .filter((b) => { const t = Date.parse(b.ts); return t >= lo && t <= endMs; })
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
    .slice(-n);
}

function peakCpu(inc: Incident, metrics: MetricSample[]): { pct: number; proc: string } {
  const lo = Date.parse(inc.startIso) - 500;
  const hi = Date.parse(inc.endIso) + 500;
  let pct = 0, proc = '';
  for (const m of metrics) {
    const t = Date.parse(m.ts);
    if (t < lo || t > hi) continue;
    // Skip our own L6 tracing instrument so peak-CPU attribution isn't "the Tracing Service".
    for (const s of m.samples ?? []) if (s.cpu > pct && s.name !== 'Tracing Service') { pct = s.cpu; proc = s.name || s.type; }
  }
  return { pct: +pct.toFixed(1), proc };
}

// Freeze/crash-class layers gate the sign-off. Advisory layers (js-error, storage, subprocess) are
// surfaced in the report but only escalate the verdict when SEVERE (a crash, disk-full, or a crashed
// child) — so a routine console.error or a near-quota warning doesn't flip a clean run.
const GATING_LAYERS: FreezeLayer[] = ['renderer-heartbeat', 'renderer-task', 'main-loop', 'hardware', 'native', 'ipc', 'stall'];

// ── Baseline: gate on REGRESSION vs a known-good run, not a static absolute ─────────────────────────
// The perception-anchored absolutes (>=3s = SEVERE, 200ms = a freeze) come from HCI research (Nielsen
// 0.1/1/10s, RAIL, Web Vitals) and stay as the default floor. But app-relative numbers (IPC rate,
// memory growth, "how slow is too slow for THIS app") have no universal value — so we record a green
// run's distribution as a baseline and flag only freezes that are NEW or materially WORSE than it.
export interface Baseline {
  createdIso: string;
  longestMs: number;
  totalMs: number;
  incidentCount: number;
  byLayer: Record<string, { count: number; worstMs: number }>; // worst freeze per primary layer
}
export function summarizeBaseline(incidents: Incident[], createdIso: string): Baseline {
  const byLayer: Record<string, { count: number; worstMs: number }> = {};
  let longestMs = 0, totalMs = 0;
  for (const i of incidents) {
    longestMs = Math.max(longestMs, i.durationMs);
    totalMs += i.durationMs;
    const k = primaryLayer(i);
    const b = byLayer[k] ?? (byLayer[k] = { count: 0, worstMs: 0 });
    b.count++; b.worstMs = Math.max(b.worstMs, i.durationMs);
  }
  return { createdIso, longestMs, totalMs, incidentCount: incidents.length, byLayer };
}
const isCrash = (inc: Incident): boolean =>
  inc.events.some((e) => e.layer === 'native' && /gone/.test(String((e.detail as { kind?: string }).kind ?? '')));
// new = a freeze on a layer the green run never had; worse = exceeds the green worst by > tolerance.
function classifyVsBaseline(inc: Incident, baseline: Baseline, tol: number): 'new' | 'worse' | 'within' {
  if (isCrash(inc)) return 'new'; // a crash is never "expected"
  const b = baseline.byLayer[primaryLayer(inc)];
  if (!b || b.count === 0) return 'new';
  if (inc.durationMs > b.worstMs * tol) return 'worse';
  return 'within';
}

function verdictOf(incidents: Incident[], baseline?: Baseline): { verdict: ReportResult['verdict']; exitCode: number } {
  if (incidents.length === 0) return { verdict: 'PASS', exitCode: 0 };
  // Baseline mode: gate on regressions (new/worse than green) + crashes — within-baseline is expected.
  if (baseline) {
    const regressions = incidents.filter((i) => i.vsBaseline && i.vsBaseline !== 'within');
    if (regressions.length === 0) return { verdict: 'PASS', exitCode: 0 };
    if (regressions.some((i) => isCrash(i) || i.severity === 'SEVERE')) return { verdict: 'FAIL', exitCode: 2 };
    if (regressions.some((i) => i.layers.some((l) => GATING_LAYERS.includes(l)))) return { verdict: 'CAUTION', exitCode: 1 };
    return { verdict: 'PASS', exitCode: 0 };
  }
  // No baseline: perception-anchored absolutes.
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
// Uptime can be days/weeks — fmtDur would print "912h", so format days+hours.
function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d >= 1 ? `${d}d ${h}h` : h >= 1 ? `${h}h ${m}m` : `${m}m`;
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

interface Script {
  sourceURL: string; functionName: string; charPos: number; duration: number;
  invoker?: string; invokerType?: string; forcedLayoutMs?: number; pauseMs?: number;
}
function allScripts(inc: Incident): Script[] {
  const all: Script[] = [];
  for (const e of inc.events) {
    const s = (e.detail as { scripts?: Script[] }).scripts;
    if (Array.isArray(s)) all.push(...s);
  }
  return all.sort((a, b) => b.duration - a.duration);
}
function topScript(inc: Incident): Script | undefined {
  return allScripts(inc)[0];
}
// Invoker-first label for a script: the real call site ('BUTTON#save.onclick'), falling back to the
// function name, and only to a raw char offset when both are empty (inline/bundled with no names).
function scriptLabel(s: Script): string {
  const who = s.invoker || s.functionName || (s.sourceURL ? '(anonymous)' : '(inline script)');
  const where = s.invokerType ? ` (${s.invokerType})` : s.invoker || s.functionName ? '' : ` (offset ${s.charPos})`;
  const url = s.sourceURL && !s.invoker ? `${s.sourceURL} → ` : '';
  return `${url}${who}${where}`;
}

// Frame-phase split + thrash/pause hints for a renderer-task event, when LoAF supplied them.
function taskPhase(d: Record<string, unknown>): string {
  const parts: string[] = [];
  const w = Number(d.workMs ?? 0), s = Number(d.styleLayoutMs ?? 0);
  if (w > 0 || s > 0) {
    if (w > 0) parts.push(`${fmtS1(w)} in script`);
    if (s > 0) parts.push(`${fmtS1(s)} in style/layout`);
  }
  return parts.length ? `: ${parts.join(', ')}` : '';
}
function scriptHint(s: Script): string {
  const hints: string[] = [];
  if (s.forcedLayoutMs && s.forcedLayoutMs > s.duration * 0.3) hints.push(`incl. ${Math.round(s.forcedLayoutMs)}ms forced reflow — layout thrashing`);
  if (s.pauseMs && s.pauseMs > s.duration * 0.3) hints.push(`${Math.round(s.pauseMs)}ms paused on a synchronous call (sync XHR / sendSync / alert)`);
  return hints.length ? ` [${hints.join('; ')}]` : '';
}

// One human-readable "where" line for a single detector event — carries the new diagnostic detail.
function evidenceLine(e: FreezeEvent): string {
  const d = e.detail as Record<string, unknown>;
  switch (e.layer) {
    case 'renderer-task': {
      const scripts = Array.isArray(d.scripts) ? (d.scripts as Script[]).slice().sort((a, b) => b.duration - a.duration) : [];
      if (scripts.length) {
        const top = scripts.slice(0, 3).map((s) => `${scriptLabel(s)} ${fmtS1(s.duration)}${scriptHint(s)}`).join('; ');
        return `blocked ${fmtS1(e.durationMs)}${taskPhase(d)} — ${top}`;
      }
      return `blocked ${e.durationMs}ms${taskPhase(d)} (${String(d.kind ?? 'long task')})`;
    }
    case 'renderer-heartbeat': {
      const route = d.route ? ` on ${String(d.route) || '/'}` : '';
      const hidden = d.visibility === 'hidden' ? ' [window hidden]' : '';
      const cores = d.cores ? ` (${String(d.cores)} cores)` : '';
      return `UI thread unresponsive for ${e.durationMs}ms${route}${cores}${hidden}`;
    }
    case 'main-loop':
      if (d.blockingChannel) return `main loop blocked ${String(d.maxLagMs ?? e.durationMs)}ms — handler '${String(d.blockingChannel)}' (${d.blockingKind === 'on' ? 'sync send' : 'invoke'}) ran ${String(d.blockingMs)}ms`;
      return `main event loop stalled ${String(d.maxLagMs ?? e.durationMs)}ms (no IPC handler matched — suspect compute/GC/sync I/O)`;
    case 'hardware': {
      if (d.kind === 'memory-balloon') {
        const who = (d.name ? `${String(d.name)} ` : '') + `${String(d.type ?? 'process')} (pid ${String(d.pid)})`;
        return `memory grew ${String(d.ratio)}× in the ${who} — ${fmtMB(Number(d.baselineKB))} → ${fmtMB(Number(d.currentKB))}`;
      }
      if (d.kind === 'sustained-cpu') {
        const who = (d.name ? `${String(d.name)} ` : '') + `${String(d.process)} process (pid ${String(d.pid)})`;
        const wake = Number(d.wakeups) > 0 && Number(d.cpuPct) < 50 ? ` — high idle wakeups (${String(d.wakeups)}/s): busy-poll/timer storm` : '';
        return `CPU ${String(d.cpuPct)}% sustained on the ${who}${wake}`;
      }
      return 'resource pressure';
    }
    case 'native': {
      if (d.kind === 'main-process-gone') return `MAIN process exited unexpectedly (code ${String(d.code)}${d.signal ? `, ${String(d.signal)}` : ''}) — the whole app went down`;
      const win = d.title || d.url ? `${d.title ? `"${String(d.title)}"` : ''}${d.url ? ` (${String(d.url)})` : ''}` : '';
      if (d.kind === 'unresponsive-bracket') return `${String(d.wcType || 'window')} ${win} became unresponsive for ${e.durationMs}ms`;
      const det = d.details as { reason?: string; exitCode?: number; type?: string; name?: string; serviceName?: string } | undefined;
      const reason = det?.reason ? `${det.reason}${det.exitCode != null ? ` (exit ${det.exitCode})` : ''}` : 'gone';
      if (d.kind === 'render-process-gone') return `renderer for ${String(d.wcType || 'window')} ${win} ${reason}`;
      if (d.kind === 'child-process-gone') {
        const name = det?.name || det?.serviceName;
        return `${det?.type ?? 'child'} process${name ? ` ${name}` : ''} ${reason}`;
      }
      return `${String(d.kind)} — ${reason}`;
    }
    case 'ipc':
      if (d.topChannel) return `channel '${String(d.topChannel)}' (${String(d.topTransport ?? 'send')}) sent ${Number(d.msgs).toLocaleString()} msgs in one interval — ${String(d.topPct)}% of traffic (~${String(d.ratePerSec)}/s)`;
      return `${String(d.msgs)} IPC messages in one interval (~${String(d.ratePerSec)}/s)`;
    case 'js-error': {
      const at = d.topFrame ? ` — at ${resolveLoc(String(d.topFrame))}` : '';
      return `${String(d.kind)}${d.where ? ` [${String(d.where)}]` : ''}: ${String(d.message ?? '')}${at}`;
    }
    case 'stall': {
      const shape = `${String(d.resourceType ?? 'request')}${d.method ? ` ${String(d.method)}` : ''}`;
      const fail = d.errorText ? ` — FAILED ${String(d.errorText)}${d.blockedReason ? ` / ${String(d.blockedReason)}` : ''}` : '';
      const by = d.initiator ? ` (started by ${resolveLoc(String(d.initiator))})` : '';
      return `${shape} stuck ${Math.round(Number(d.ageMs ?? e.durationMs) / 1000)}s — ${String(d.target ?? '')}${fail}${by}`;
    }
    case 'storage':
      if (d.kind === 'storage-pressure') return `storage at ${String(d.pct)}% of quota (${fmtMB(Number(d.usageKB))} / ${fmtMB(Number(d.quotaKB))})${d.biggest ? ` — biggest: ${String(d.biggest)}` : ''}${d.origin ? ` (${String(d.origin)})` : ''}`;
      if (d.kind === 'disk-low') return `disk low: ${fmtMB(Number(d.freeKB))} free${d.path ? ` on ${String(d.path)}` : ' on the userData volume'}`;
      if (d.kind === 'slow-disk') return `slow disk: ${String(d.ms)}ms for a tiny write${d.path ? ` to ${String(d.path)}` : ' to userData'}`;
      return 'storage/disk pressure';
    case 'subprocess': {
      const what = String(d.argv || d.cmd);
      if (d.kind === 'subprocess-hung') return `child still running after ${Math.round(Number(d.ageMs) / 1000)}s: ${what} (pid ${String(d.pid)})`;
      if (d.kind === 'subprocess-spawn-error') return `spawn failed: ${String(d.message)} — ${what}`;
      if (d.kind === 'subprocess-crashed') {
        const err = d.stderrTail ? ` — stderr: ${String(d.stderrTail).trim().split('\n').slice(-1)[0]}` : '';
        return `child exited abnormally: ${what} (code ${String(d.code)}${d.signal ? `, ${String(d.signal)}` : ''})${err}`;
      }
      return 'subprocess problem';
    }
    default: return `${e.durationMs}ms`;
  }
}

// The single most useful "root cause" pointer for an incident. Sourced from the PRIMARY layer:
// only a renderer layer lets the LoAF script own the root cause — otherwise a main-process freeze
// wrongly showed a renderer char offset (the old bug).
function culprit(inc: Incident): string {
  const p = primaryLayer(inc);
  if (p === 'renderer-task' || p === 'renderer-heartbeat') {
    const s = topScript(inc);
    if (s) return scriptLabel(s);
  }
  const ev = inc.events.find((e) => e.layer === p) ?? inc.events[0];
  return ev ? evidenceLine(ev) : '—';
}

// Does this incident have a concrete, named root cause (vs a generic "stalled"/"resource pressure")?
function hasNamedCause(inc: Incident): boolean {
  const p = primaryLayer(inc);
  if (p === 'renderer-task') return !!topScript(inc);
  const d = (inc.events.find((e) => e.layer === p)?.detail ?? {}) as Record<string, unknown>;
  if (p === 'main-loop') return !!d.blockingChannel;
  if (p === 'ipc') return !!d.topChannel;
  if (p === 'hardware') return !!d.pid;
  if (p === 'native') return !!(d.title || d.url || (d.details as { type?: string })?.type);
  if (p === 'renderer-heartbeat') return !!d.route;
  return false;
}

// ── Confidence × impact ranking: which incident is most likely a real bug, and how to highlight it ─
// Confidence comes from corroboration (independent layers agreeing), being tied to a user action,
// and having a named cause. Impact comes from severity. A low-confidence, low-impact, idle blip is
// demoted as likely noise so the real bug isn't buried.
const FREEZE_LAYER_SET = FREEZE_GROUP;
function confidenceOf(inc: Incident): { score: number; reasons: string[] } {
  const layers = new Set(inc.layers.filter((l) => FREEZE_LAYER_SET.has(l))).size;
  const tied = !!inc.action && inc.action !== '(idle / between steps)';
  const named = hasNamedCause(inc);
  let score = 0;
  const reasons: string[] = [];
  if (layers >= 3) { score += 2; reasons.push(`${layers} layers agree`); }
  else if (layers === 2) { score += 1; reasons.push('2 layers agree'); }
  else if (layers === 1) reasons.push('1 layer only');
  if (tied) { score += 1; reasons.push(`tied to ${inc.action}`); }
  else reasons.push('not tied to an action');
  if (named) { score += 1; reasons.push('named cause'); }
  return { score, reasons };
}
function impactRank(inc: Incident): number {
  // A regression vs baseline outranks any within-baseline freeze, however severe — that's the point.
  const regression = inc.vsBaseline && inc.vsBaseline !== 'within' ? 100_000 : 0;
  return regression + SEV_RANK[inc.severity] * 100 + Math.min(99, Math.round(inc.durationMs / 100));
}
const confLabel = (inc: Incident): string => ((inc.confidence ?? 0) >= 3 ? 'high' : (inc.confidence ?? 0) === 2 ? 'medium' : 'low');
// Signal incidents, worst-first; and the demoted-noise bucket.
function rankIncidents(incidents: Incident[]): { signal: Incident[]; noise: Incident[] } {
  const signal = incidents.filter((i) => !i.noise).sort((a, b) => impactRank(b) - impactRank(a) || (b.confidence ?? 0) - (a.confidence ?? 0));
  return { signal, noise: incidents.filter((i) => i.noise) };
}
// Likely noise: MINOR, single-layer, untied, unnamed — present for completeness but out of the way.
function isLikelyNoise(inc: Incident): boolean {
  return inc.severity === 'MINOR' && confidenceOf(inc).score === 0 && !hasNamedCause(inc);
}
// "Where to look next" — names the exact artifact + filter to drill into for this incident.
function whereToLookNext(inc: Incident): string {
  const p = primaryLayer(inc);
  const at = hhmmss(inc.startIso);
  switch (p) {
    case 'renderer-task':
    case 'renderer-heartbeat':
      return `renderer-tasks.jsonl around ${at}; trace.json at ${at} → DevTools Performance (renderer main thread)`;
    case 'main-loop': {
      const d = inc.events.find((e) => e.layer === 'main-loop')?.detail as Record<string, unknown> | undefined;
      return d?.blockingChannel
        ? `open the ipcMain.${d.blockingKind === 'on' ? 'on' : 'handle'}('${String(d.blockingChannel)}') handler. NB: the main process is NOT in trace.json (Chromium-only) — attach --inspect to profile it`
        : `main process — attach --inspect and profile; not visible in trace.json`;
    }
    case 'ipc':
      return `ipc.jsonl around ${at} for the per-channel breakdown`;
    case 'hardware': {
      const d = inc.events.find((e) => e.layer === 'hardware')?.detail as Record<string, unknown> | undefined;
      return `metrics.jsonl around ${at}${d?.pid ? `, pid ${String(d.pid)}` : ''}; attach a heap profiler to that process`;
    }
    case 'native':
      return `the named window/process above; check the crash reason; correlate with the freeze just before`;
    case 'js-error':
      return `js-errors.jsonl for the full stack`;
    case 'stall':
      return `add a timeout/AbortController at the initiator above`;
    case 'subprocess':
      return `subprocess.jsonl for this pid; read the stderr above`;
    case 'storage':
      return `storage.jsonl around ${at}`;
    default:
      return `freezes.jsonl around ${at}`;
  }
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

// Each layer's raw evidence stream, for the "drill in here" pointer on its per-layer report.
const LAYER_JSONL: Partial<Record<FreezeLayer, string>> = {
  'renderer-task': 'renderer-tasks.jsonl', hardware: 'metrics.jsonl', ipc: 'ipc.jsonl',
  'js-error': 'js-errors.jsonl', storage: 'storage.jsonl', subprocess: 'subprocess.jsonl',
};

// One focused report per layer that fired: every event of that layer with full detail + a pointer to
// the raw stream. The main report stays an executive index; these are the deep-dives you asked for.
function renderLayerReports(runDir: string, events: FreezeEvent[]): FreezeLayer[] {
  const byLayer = new Map<FreezeLayer, FreezeEvent[]>();
  for (const e of events) (byLayer.get(e.layer) ?? byLayer.set(e.layer, []).get(e.layer)!).push(e);
  byLayer.delete('deep');
  if (byLayer.size === 0) return [];
  mkdirSync(join(runDir, 'layers'), { recursive: true });
  const written: FreezeLayer[] = [];
  for (const [layer, evs] of byLayer) {
    const info = LAYER_INFO[layer];
    const L: string[] = [];
    L.push(`# ${info.label} — layer detail`, '');
    L.push(`**What this detects:** ${info.what}`, '');
    L.push(`**General fix:** ${info.fix}`, '');
    const jsonl = LAYER_JSONL[layer];
    if (jsonl) L.push(`**Raw evidence:** \`${jsonl}\` (full, unfiltered stream)`, '');
    L.push('', `## Events (${evs.length})`, '');
    L.push('| When | Duration | Severity | Triggered by | Detail |', '|------|----------|----------|--------------|--------|');
    for (const e of [...evs].sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso))) {
      L.push(`| ${hhmmss(e.startIso)} | ${fmtS1(e.durationMs)} | ${e.severity} | ${e.action ?? '—'} | ${evidenceLine(e).replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`);
    }
    L.push('');
    writeFileSync(join(runDir, 'layers', `${layer}.md`), L.join('\n'));
    written.push(layer);
  }
  return written;
}

// ── Per-step trace + rich evidence (Markdown) ───────────────────────────────────────────────────────
// "What the app did" — per scenario step: duration + responsiveness + IPC volume + freeze.
function renderPerStepMarkdown(steps: StepMetrics[]): string {
  if (steps.length === 0) return '';
  const L: string[] = ['## What the app did — per step', ''];
  L.push('| Step | Duration | Worst UI gap | Worst main lag | IPC msgs | Invoke p95 | Froze |',
         '|------|----------|--------------|----------------|----------|-----------|-------|');
  for (const s of steps) {
    L.push(`| ${esc(s.name)} | ${fmtSec(s.durationMs)} | ${s.worstUiGapMs || '—'}${s.worstUiGapMs ? 'ms' : ''} | ${s.worstMainLagMs || '—'}${s.worstMainLagMs ? 'ms' : ''} | ${s.ipcMsgs} | ${s.ipcReplyP95Ms || '—'}${s.ipcReplyP95Ms ? 'ms' : ''} | ${s.froze ? `${fmtS1(s.worstFreezeMs)} [${s.freezeLayers.join(', ')}]` : '—'} |`);
  }
  L.push('');
  return L.join('\n');
}

function renderEvidenceMarkdown(ev: EvidenceSummary): string {
  const L: string[] = ['## Evidence by layer', '',
    'The actual data each layer captured — summaries + real sample records. Full unfiltered streams are linked under Artifacts.', ''];

  // IPC
  L.push(`### 🔌 IPC — ${ev.ipc.total.toLocaleString()} messages (${ev.ipc.r2m.toLocaleString()} renderer→main, ${ev.ipc.m2r.toLocaleString()} main→renderer, ${fmtKB(ev.ipc.bytes)})`, '');
  if (ev.ipc.total > 0) {
    L.push(`By transport: ${Object.entries(ev.ipc.byTransport).map(([k, v]) => `${k} ${v.toLocaleString()}`).join(' · ')}`, '');
    if (ev.ipc.channels.length) {
      L.push('| Channel | Transport | Dir | Count | Bytes | Max latency | Called by (app call-site) |', '|---|---|---|---|---|---|---|');
      for (const c of ev.ipc.channels) L.push(`| ${esc(c.channel)} | ${c.transport} | ${c.dir} | ${c.count.toLocaleString()} | ${fmtKB(c.bytes)} | ${c.maxLatencyMs != null ? c.maxLatencyMs + 'ms' : '—'} | ${esc(c.at ?? '') || '—'} |`);
      L.push('');
    }
    if (ev.ipc.slowestInvokes.length) L.push(`**Slowest invokes:** ${ev.ipc.slowestInvokes.map((i) => `\`${i.channel}\` ${i.latencyMs}ms`).join(' · ')}`, '');
    if (ev.ipc.samples.length) {
      L.push('Sample messages:', '', '| Transport | Channel | Dir | Size | Preview |', '|---|---|---|---|---|');
      for (const s of ev.ipc.samples) L.push(`| ${s.transport} | ${esc(s.channel)} | ${s.dir} | ${s.size} | ${esc(s.preview) || '—'} |`);
      L.push('');
    }
  }

  // Network
  L.push(`### 🌐 Network — ${ev.network.total} request(s), ${ev.network.failed} failed`, '');
  if (ev.network.slowest.length) {
    L.push('| URL | Status | Time | Size | Started by |', '|---|---|---|---|---|');
    for (const r of ev.network.slowest) L.push(`| ${esc(r.url.slice(0, 70))} | ${r.status ?? 'FAILED'} | ${r.ms}ms | ${r.size} | ${esc((r.initiator ?? '').slice(0, 40)) || '—'} |`);
    L.push('');
  }

  // Main loop
  L.push(`### ⚙️ Main process — event-loop lag p50 ${ev.mainLoop.lagP50}ms · p95 ${ev.mainLoop.lagP95}ms · max ${ev.mainLoop.lagMax}ms`, '');
  if (ev.mainLoop.handlers.length) {
    L.push('IPC handler timings:', '', '| Handler | Calls | Max | Total |', '|---|---|---|---|');
    for (const h of ev.mainLoop.handlers) L.push(`| ${esc(h.label)} | ${h.calls} | ${h.maxMs}ms | ${h.totalMs}ms |`);
    L.push('');
  }

  // CPU / memory
  if (ev.cpuMem.processes.length) {
    L.push('### 🧠 CPU / memory — peak per process', '', '| Process | Peak CPU | Peak memory |', '|---|---|---|');
    for (const p of ev.cpuMem.processes) L.push(`| ${esc(p.name)} | ${p.peakCpu}% | ${p.peakMemMB} MB |`);
    L.push('');
  }

  // Errors
  if (ev.errors.length) {
    L.push(`### 🐛 JS errors — ${ev.errors.length}`, '');
    for (const e of ev.errors) L.push(`- **${e.kind}** [${e.where}] ${esc(e.message)}${e.at ? ` — \`${esc(e.at)}\`` : ''}`);
    L.push('');
  }

  // Heartbeat
  if (ev.heartbeat.jankCount > 0) {
    L.push(`### 🫀 Renderer UI gaps — ${ev.heartbeat.jankCount} jank event(s), worst ${ev.heartbeat.worstMs}ms`, '');
    for (const r of ev.heartbeat.routes) L.push(`- ${esc(r.route)} — ${r.count} gap(s), worst ${r.worstMs}ms`);
    L.push('');
  }

  // Storage writes — traced to the app call-site that wrote each key.
  if (ev.storageOps.total > 0 || ev.storageOps.snapshotKeys > 0) {
    L.push(`### 💾 Storage writes — ${ev.storageOps.total} op(s): ${ev.storageOps.sets} set · ${ev.storageOps.removes} remove · ${ev.storageOps.clears} clear (left ${ev.storageOps.snapshotKeys} keys, ${fmtMB(ev.storageOps.snapshotBytes / 1024)})`, '');
    if (ev.storageOps.byKey.length) {
      L.push('| Key | Area | Writes | Bytes | Written by (call-site) |', '|---|---|---|---|---|');
      for (const k of ev.storageOps.byKey) L.push(`| ${esc(k.key)} | ${k.area} | ${k.writes} | ${k.bytes} | ${esc(k.at) || '—'} |`);
      L.push('');
    }
  }

  // Host — with app-vs-host CPU attribution.
  if (ev.host) {
    const h = ev.host;
    L.push(`### 🖥️ Host — ${esc(h.cpuModel ?? 'unknown CPU')}${h.cores ? ` (${h.cores} cores)` : ''}${h.platform ? `, ${h.platform}` : ''}`, '');
    L.push(`- **Host CPU:** peak ${h.hostCpuPeak}% · avg ${h.hostCpuAvg}% — **of which the app's own processes peaked ${h.appCpuPeak}%** (${h.appCpuPeak >= h.hostCpuPeak * 0.6 ? 'load is mostly the app' : 'much of the load is external — results may be confounded'})`);
    L.push(`- **Free memory low-water:** ${h.freeMemLowMB} MB · **peak load avg:** ${h.loadPeak}`, '');
  }

  // Stream inventory (links to full data)
  if (ev.counts.length) {
    L.push('### 📂 Full streams', '', '| Stream | Records | What |', '|---|---|---|');
    for (const c of ev.counts) L.push(`| \`${c.file}\` | ${c.count.toLocaleString()} | ${c.what} |`);
    L.push('');
  }
  return L.join('\n');
}

// ── Dashboard: per-step lanes + evidence panels (HTML) ──────────────────────────────────────────────
const tbl = (head: string[], rows: string[][]): string =>
  `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

function renderEvidenceHtml(steps: StepMetrics[], ev: EvidenceSummary): string {
  const P: string[] = [];

  // Per-step lanes — the headline visual: each scenario step as a duration bar with what happened.
  if (steps.length) {
    const max = Math.max(...steps.map((s) => s.durationMs), 1);
    const lanes = steps.map((s) => {
      const w = Math.max(3, Math.round((s.durationMs / max) * 100));
      const cls = s.froze ? (s.worstFreezeMs >= 3000 ? 'sev-severe' : 'sev-moderate') : 'sev-ok';
      const chips = [
        s.ipcMsgs ? `<span class="dchip">${s.ipcMsgs.toLocaleString()} IPC</span>` : '',
        s.worstMainLagMs ? `<span class="dchip">lag ${s.worstMainLagMs}ms</span>` : '',
        s.worstUiGapMs ? `<span class="dchip">UI gap ${s.worstUiGapMs}ms</span>` : '',
        s.ipcReplyP95Ms ? `<span class="dchip">invoke p95 ${s.ipcReplyP95Ms}ms</span>` : '',
        s.froze ? `<span class="dchip froze">froze ${fmtS1(s.worstFreezeMs)}</span>` : '',
      ].filter(Boolean).join('');
      return `<div class="lane"><span class="lane-name" title="${esc(s.name)}">${esc(s.name)}</span>
        <span class="lane-track"><span class="lane-fill ${cls}" style="width:${w}%"></span></span>
        <span class="lane-dur">${fmtSec(s.durationMs)}</span><span class="lane-chips">${chips}</span></div>`;
    }).join('');
    P.push(`<h2>What the app did — per step</h2><div class="lanes">${lanes}</div>`);
  }

  // Evidence panels grid.
  const panels: string[] = [];

  // IPC
  if (ev.ipc.total > 0) {
    const chanRows = ev.ipc.channels.map((c) => [esc(c.channel), c.transport, c.dir, c.count.toLocaleString(), fmtKB(c.bytes), c.maxLatencyMs != null ? c.maxLatencyMs + 'ms' : '—', c.at ? `<code>${esc(c.at)}</code>` : '—']);
    const sampleRows = ev.ipc.samples.map((s) => [s.transport, esc(s.channel), s.dir, s.size, `<code>${esc(s.preview) || '—'}</code>`]);
    panels.push(`<div class="panel"><h3>🔌 IPC <span class="big">${ev.ipc.total.toLocaleString()}</span> messages</h3>
      <p class="sub">${ev.ipc.r2m.toLocaleString()} renderer→main · ${ev.ipc.m2r.toLocaleString()} main→renderer · ${fmtKB(ev.ipc.bytes)} · ${Object.entries(ev.ipc.byTransport).map(([k, v]) => `${k} ${v.toLocaleString()}`).join(', ')}</p>
      ${ev.ipc.slowestInvokes.length ? `<p class="sub">Slowest invokes: ${ev.ipc.slowestInvokes.map((i) => `<code>${esc(i.channel)}</code> ${i.latencyMs}ms`).join(' · ')}</p>` : ''}
      <h4>Top channels — called by</h4>${tbl(['Channel', 'Transport', 'Dir', 'Count', 'Bytes', 'Max latency', 'Called by'], chanRows)}
      ${sampleRows.length ? `<h4>Sample messages</h4>${tbl(['Transport', 'Channel', 'Dir', 'Size', 'Preview'], sampleRows)}` : ''}</div>`);
  }

  // Network
  if (ev.network.total > 0) {
    panels.push(`<div class="panel"><h3>🌐 Network <span class="big">${ev.network.total}</span> requests</h3>
      <p class="sub">${ev.network.failed} failed</p>
      ${tbl(['URL', 'Status', 'Time', 'Size', 'Started by'], ev.network.slowest.map((r) => [esc(r.url.slice(0, 60)), String(r.status ?? 'FAILED'), r.ms + 'ms', r.size, esc((r.initiator ?? '').slice(0, 36)) || '—']))}</div>`);
  }

  // Main loop
  if (ev.mainLoop.lagSamples > 0 || ev.mainLoop.handlers.length) {
    panels.push(`<div class="panel"><h3>⚙️ Main process</h3>
      <p class="sub">event-loop lag p50 <b>${ev.mainLoop.lagP50}ms</b> · p95 <b>${ev.mainLoop.lagP95}ms</b> · max <b>${ev.mainLoop.lagMax}ms</b></p>
      ${ev.mainLoop.handlers.length ? `<h4>IPC handler timings</h4>${tbl(['Handler', 'Calls', 'Max', 'Total'], ev.mainLoop.handlers.map((h) => [esc(h.label), String(h.calls), h.maxMs + 'ms', h.totalMs + 'ms']))}` : ''}</div>`);
  }

  // CPU / memory
  if (ev.cpuMem.processes.length) {
    panels.push(`<div class="panel"><h3>🧠 CPU / memory</h3><p class="sub">peak per process</p>
      ${tbl(['Process', 'Peak CPU', 'Peak memory'], ev.cpuMem.processes.map((p) => [esc(p.name), p.peakCpu + '%', p.peakMemMB + ' MB']))}</div>`);
  }

  // Errors
  if (ev.errors.length) {
    panels.push(`<div class="panel"><h3>🐛 JS errors <span class="big">${ev.errors.length}</span></h3>
      <ul class="errlist">${ev.errors.map((e) => `<li><b>${esc(e.kind)}</b> <span class="lvl">${esc(e.where)}</span> ${esc(e.message)}${e.at ? `<br><code>${esc(e.at)}</code>` : ''}</li>`).join('')}</ul></div>`);
  }

  // Heartbeat
  if (ev.heartbeat.jankCount > 0) {
    panels.push(`<div class="panel"><h3>🫀 Renderer UI gaps <span class="big">${ev.heartbeat.jankCount}</span></h3>
      <p class="sub">worst ${ev.heartbeat.worstMs}ms</p>
      ${tbl(['Route', 'Gaps', 'Worst'], ev.heartbeat.routes.map((r) => [esc(r.route.length > 50 ? '…' + r.route.slice(-50) : r.route), String(r.count), r.worstMs + 'ms']))}</div>`);
  }

  // Storage writes — who wrote each key.
  if (ev.storageOps.total > 0 || ev.storageOps.snapshotKeys > 0) {
    panels.push(`<div class="panel"><h3>💾 Storage writes <span class="big">${ev.storageOps.total}</span></h3>
      <p class="sub">${ev.storageOps.sets} set · ${ev.storageOps.removes} remove · ${ev.storageOps.clears} clear · left ${ev.storageOps.snapshotKeys} keys (${fmtMB(ev.storageOps.snapshotBytes / 1024)})</p>
      ${ev.storageOps.byKey.length ? `<h4>By key — written by</h4>${tbl(['Key', 'Area', 'Writes', 'Bytes', 'Call-site'], ev.storageOps.byKey.map((k) => [esc(k.key), k.area, String(k.writes), String(k.bytes), `<code>${esc(k.at) || '—'}</code>`]))}` : ''}</div>`);
  }

  // Host — app-vs-host attribution.
  if (ev.host) {
    const h = ev.host;
    const appShare = h.hostCpuPeak > 0 ? Math.round((h.appCpuPeak / h.hostCpuPeak) * 100) : 0;
    panels.push(`<div class="panel"><h3>🖥️ Host</h3>
      <p class="sub">${esc(h.cpuModel ?? 'unknown CPU')}${h.cores ? ` · ${h.cores} cores` : ''}${h.platform ? ` · ${h.platform}` : ''}</p>
      ${tbl(['Metric', 'Value'], [
        ['Host CPU peak', `${h.hostCpuPeak}% (avg ${h.hostCpuAvg}%)`],
        ['↳ app processes peak', `${h.appCpuPeak}% — ${appShare >= 60 ? 'load is mostly the app' : 'much is external (possible confounder)'}`],
        ['Free memory low', `${h.freeMemLowMB} MB`],
        ['Peak load average', String(h.loadPeak)],
      ])}</div>`);
  }

  if (panels.length) P.push(`<h2>Evidence by layer</h2><div class="panels">${panels.join('')}</div>`);

  // Full-stream inventory (links to raw data).
  if (ev.counts.length) {
    P.push(`<h2>Full streams</h2><p class="streams">${ev.counts.map((c) => `<a href="${c.file}">${c.file}</a> <span>${c.count.toLocaleString()}</span>`).join(' · ')}</p>`);
  }
  return P.join('\n');
}

/** Read a run's evidence and write report.md + report.html. Returns verdict + exit code for CI. */
export function buildReport(runDir: string, meta: ReportMeta): ReportResult {
  const rawFreezes = readJsonl<FreezeEvent>(join(runDir, 'freezes.jsonl'));
  const actions = readJsonl<ActionWindow>(join(runDir, 'actions.jsonl'));
  const metrics = readJsonl<MetricSample>(join(runDir, 'metrics.jsonl'));
  const breadcrumbs = readJsonl<Breadcrumb>(join(runDir, 'breadcrumbs.jsonl'));

  const correlated = correlate(rawFreezes, actions);
  const incidents = mergeIncidents(correlated); // sorted by start
  let prevEnd = -Infinity;
  for (const inc of incidents) {
    const pc = peakCpu(inc, metrics); inc.peakCpuPct = pc.pct; inc.peakCpuProc = pc.proc;
    const start = Date.parse(inc.startIso);
    // Only context since the previous freeze ended (capped at 30s), so each incident shows what's
    // new — not every line logged earlier in the session.
    const lookback = Math.min(30_000, Math.max(0, start - prevEnd));
    inc.breadcrumbs = breadcrumbsFor(start, Date.parse(inc.endIso), breadcrumbs, 6, lookback);
    prevEnd = Math.max(prevEnd, Date.parse(inc.endIso));
    const c = confidenceOf(inc);
    inc.confidence = c.score; inc.confidenceReasons = c.reasons;
  }

  // Baseline (optional): tag each incident new/worse/within vs a known-good run so the verdict gates
  // on REGRESSION rather than a static absolute. BASELINE_FILE = the baseline to compare against;
  // SAVE_BASELINE = record THIS run as the new baseline; BASELINE_TOLERANCE (default 1.2) = how much
  // worse than green counts as a regression.
  const tol = Number(process.env.BASELINE_TOLERANCE) || 1.2;
  let baseline: Baseline | undefined;   // old freeze-only baseline (back-compat with freeze-baseline.json)
  let buildDiff: RunDiff | undefined;   // new per-step build comparison (build-baseline.json with .steps)
  const baselineFile = process.env.BASELINE_FILE;
  if (baselineFile && existsSync(baselineFile)) {
    try {
      const parsed = JSON.parse(readFileSync(baselineFile, 'utf8')) as Partial<RunSummary> & Partial<Baseline>;
      if (Array.isArray(parsed.steps)) {
        // New build-baseline → diff THIS run's per-step metrics against it (timing + freeze), and
        // render the comparison inline in this run's own report.
        const thisSteps = readRunSteps(runDir);
        buildDiff = diffStepSets(parsed.steps as StepMetrics[], thisSteps, {
          tolerance: tol, absMinMs: 50,
          oldBuild: (parsed as RunSummary).build ?? { label: 'baseline' },
          newBuild: { label: meta.appLabel, version: meta.appVersion },
        });
      } else if (parsed.byLayer) {
        baseline = parsed as Baseline; // legacy freeze-only baseline
      }
    } catch { /* bad baseline → ignore, fall back to absolutes */ }
  }
  for (const inc of incidents) {
    if (baseline) { inc.vsBaseline = classifyVsBaseline(inc, baseline, tol); inc.baselineWorstMs = baseline.byLayer[primaryLayer(inc)]?.worstMs ?? 0; }
    // within-baseline freezes are expected → demote them like noise so regressions stand out.
    inc.noise = isLikelyNoise(inc) || inc.vsBaseline === 'within';
  }
  if (process.env.SAVE_BASELINE) {
    writeFileSync(process.env.SAVE_BASELINE, JSON.stringify(summarizeRun(runDir, meta.sessionEndIso, { label: meta.appLabel, version: meta.appVersion }), null, 2));
  }
  const baselineLabel = baseline
    ? `vs baseline (green ${baseline.createdIso.slice(0, 10)}, tolerance ${tol}×)`
    : buildDiff ? `vs build ${buildDiff.oldBuild.label}${buildDiff.oldBuild.version ? ` v${buildDiff.oldBuild.version}` : ''} (tolerance ${tol}×)`
    : process.env.SAVE_BASELINE ? `recorded this run as the baseline → ${process.env.SAVE_BASELINE}` : undefined;

  let { verdict, exitCode } = verdictOf(incidents, baseline);
  // Fold the build-diff verdict in: the run's verdict is the worse of the freeze verdict and the
  // per-step build-regression verdict, so a timing regression with no freeze still gates CI.
  if (buildDiff) {
    const rank = { PASS: 0, CAUTION: 1, FAIL: 2 } as const;
    if (rank[buildDiff.verdict] > rank[verdict]) { verdict = buildDiff.verdict; exitCode = buildDiff.exitCode; }
  }
  const longest = incidents.reduce((a, i) => Math.max(a, i.durationMs), 0);
  const total = incidents.reduce((a, i) => a + i.durationMs, 0);
  const avg = incidents.length ? total / incidents.length : 0;

  const artifacts = {
    video: existsSync(join(runDir, 'video.webm')),
    trace: existsSync(join(runDir, 'trace.json')),
  };
  const layerFiles = renderLayerReports(runDir, correlated);
  const steps = readRunSteps(runDir);
  const evidence = readEvidenceSummary(runDir);
  let md = renderMarkdown({ meta, incidents, verdict, longest, total, avg, rawFreezes, artifacts, layerFiles, baselineLabel, steps, evidence });
  let html = renderHtml({ meta, incidents, verdict, longest, total, artifacts, layerFiles, baselineLabel, steps, evidence });
  // Embed the build comparison inline (so the new build's own report shows what changed vs the old).
  if (buildDiff) {
    md += '\n\n---\n\n' + renderDiffMarkdown(buildDiff);
    html = html.replace('<!--BUILDDIFF-->', diffSectionHtml(buildDiff));
  }

  const base = `electron-freeze-report-${stamp(meta.sessionStartIso)}`;
  const mdPath = join(runDir, `${base}.md`);
  const htmlPath = join(runDir, 'report.html');
  writeFileSync(mdPath, md);
  writeFileSync(htmlPath, html);
  return { verdict, exitCode, mdPath, htmlPath, incidents };
}

// Compact per-incident baseline tag for tables/headers.
const baselineTag = (i: Incident): string =>
  i.vsBaseline === 'new' ? '🔺 new' : i.vsBaseline === 'worse' ? `🔺 worse (green ${fmtS1(i.baselineWorstMs ?? 0)})` : i.vsBaseline === 'within' ? '✓ within' : '—';

function renderMarkdown(a: {
  meta: ReportMeta; incidents: Incident[]; verdict: ReportResult['verdict'];
  longest: number; total: number; avg: number; rawFreezes: FreezeEvent[];
  artifacts: { video: boolean; trace: boolean }; layerFiles: FreezeLayer[]; baselineLabel?: string;
  steps: StepMetrics[]; evidence: EvidenceSummary;
}): string {
  const { meta, incidents, verdict } = a;
  const start = new Date(meta.sessionStartIso), end = new Date(meta.sessionEndIso);
  const hasBaseline = !!a.baselineLabel && incidents.some((i) => i.vsBaseline);
  const L: string[] = [];
  L.push('# Electron Monitoring — Evidence Report', '');
  L.push(`What **${meta.appLabel}**${meta.appVersion ? ` (v${meta.appVersion})` : ''} did across ${a.steps.length} step(s): full per-layer evidence + a freeze drill-down. Verdict gates CI.`, '');
  L.push('| Field | Value |', '|-------|-------|');
  L.push(`| Date | ${meta.sessionStartIso.slice(0, 10)} |`);
  L.push(`| Session | ${start.toTimeString().slice(0, 8)} → ${end.toTimeString().slice(0, 8)} (${fmtDur(end.getTime() - start.getTime())}) |`);
  L.push(`| App | ${meta.appLabel}${meta.appVersion ? ` (v${meta.appVersion})` : ''} |`);
  L.push(`| Launch Mode | ${meta.launchMode}${meta.mainLayers ? '' : ' (main-process layers L3/L4/L5/L7 unavailable)'} |`);
  if (meta.hostUptimeSec != null) L.push(`| Host uptime | ${fmtUptime(meta.hostUptimeSec)} |`);
  L.push(`| Main-process layers | ${meta.mainLayers ? 'available' : 'unavailable (plain cdp — add --inspect)'} |`);
  L.push(`| Freeze Threshold | ${meta.thresholdMs}ms |`);
  L.push(`| Gate | ${a.baselineLabel ?? 'absolute thresholds (no baseline) — perception-anchored: ≥3s = FAIL'} |`);
  L.push(`| **Verdict** | **${VERDICT_EMOJI[verdict]} ${verdict}** |`, '');

  // Lead with what the app DID — per-step trace + the rich per-layer evidence — then the freeze drill-down.
  L.push(renderPerStepMarkdown(a.steps));
  L.push(renderEvidenceMarkdown(a.evidence));

  // Soft environmental note: a long-up host can degrade (memory fragmentation, leaked fds, stale GPU
  // state) and make freezes that a fresh boot wouldn't. Context for triage, not a verdict change.
  if (meta.hostUptimeSec != null && meta.hostUptimeSec > HIGH_UPTIME_SEC && incidents.length > 0) {
    L.push(`> ⚠️ **Host has been up ${fmtUptime(meta.hostUptimeSec)}.** Long uptime can degrade a machine`
      + ` (memory fragmentation, leaked file descriptors, stale GPU/driver state); these freezes may`
      + ` reflect the environment, not the app. Re-run on a freshly-booted host to confirm.`, '');
  }

  const { signal, noise } = rankIncidents(incidents);
  if (incidents.length === 0) {
    L.push('## Result', '', 'No freezes detected during the session. 🎉', '');
  } else {
    // Start here: the single highest impact × confidence incident — the one most likely a real bug.
    const top = signal[0];
    if (top) {
      L.push('## 🔎 Start here', '');
      L.push(`The most likely bug: **${LAYER_INFO[primaryLayer(top)].label}** during **${top.action}** — ${fmtS1(top.durationMs)}, ${top.severity}.`, '');
      L.push(`- **Root cause:** ${culprit(top)}`);
      L.push(`- **Why this one (confidence ${confLabel(top)}):** ${top.confidenceReasons?.join(' · ')}`);
      L.push(`- **Look next:** ${whereToLookNext(top)}`, '');
    }

    const hasBaseline = !!a.baselineLabel && incidents.some((i) => i.vsBaseline);
    if (signal.length) {
      L.push('## Freezes by priority', '');
      const bh = hasBaseline ? ' Vs baseline |' : '';
      const bsep = hasBaseline ? '------------|' : '';
      L.push(`| Rank | When | Triggered by | What froze | Duration | Severity | Confidence |${bh}`);
      L.push(`|---|------|--------------|-----------|----------|----------|------------|${bsep}`);
      signal.forEach((i, n) => {
        const bcol = hasBaseline ? ` ${baselineTag(i)} |` : '';
        L.push(`| ${n + 1} | ${hhmmss(i.startIso)} | ${i.action} | ${LAYER_INFO[primaryLayer(i)].label} | ${fmtS1(i.durationMs)} | ${i.severity} | ${confLabel(i)} |${bcol}`);
      });
      L.push('');
    }

    L.push('## Diagnosis', '');
    signal.forEach((i, n) => {
      const p = primaryLayer(i);
      L.push(`### #${n + 1} · ${LAYER_INFO[p].label} · ${fmtS1(i.durationMs)} (${i.severity})`, '');
      if (i.vsBaseline) L.push(`- **Vs baseline:** ${baselineTag(i)}${i.vsBaseline === 'new' ? ' — the green run had no freeze on this layer' : ''}`);
      L.push(`- **Confidence:** ${confLabel(i)} — ${i.confidenceReasons?.join(' · ')}`);
      L.push(`- **Triggered by:** ${i.action}`);
      L.push(`- **Where (root cause):** ${culprit(i)}`);
      L.push(`- **What happened:** ${LAYER_INFO[p].what}`);
      L.push(`- **CPU:** ${cpuNote(i, meta.mainLayers)}`);
      L.push(`- **Next step:** ${LAYER_INFO[p].fix}`);
      L.push(`- **Where to look next:** ${whereToLookNext(i)}`);
      const others = i.events.map((e) => `${LAYER_INFO[e.layer].label}: ${evidenceLine(e)}`);
      L.push(`- **Signals:** ${[...new Set(others)].join('; ')}`);
      if (i.breadcrumbs?.length) {
        L.push('- **App logged just before:**');
        for (const b of i.breadcrumbs) L.push(`  - \`${hhmmss(b.ts)}\` [${b.level}] ${b.text.replace(/\n/g, ' ')}`);
      }
      L.push('');
    });

    if (noise.length) {
      L.push(hasBaseline ? `## Within baseline / low-confidence (${noise.length})` : `## Likely noise (${noise.length})`, '');
      L.push(hasBaseline
        ? 'Expected (matches the known-good baseline) or low-confidence. Not regressions — check these last.'
        : 'Low-confidence: single-layer, not tied to an action, sub-second. Shown for completeness — check these last.', '');
      for (const i of noise) L.push(`- \`${hhmmss(i.startIso)}\` ${LAYER_INFO[primaryLayer(i)].label} · ${fmtS1(i.durationMs)} · ${i.action}${i.vsBaseline ? ` · ${baselineTag(i)}` : ''}`);
      L.push('');
    }

    L.push('## Summary', '');
    L.push(`- **Freezes:** ${incidents.length} · **worst:** ${fmtS1(a.longest)} · **total frozen:** ${fmtS1(a.total)} · **average:** ${fmtS1(a.avg)}`);
    const byLayer = a.rawFreezes.reduce<Record<string, number>>((m, e) => ((m[LAYER_INFO[e.layer].label] = (m[LAYER_INFO[e.layer].label] ?? 0) + 1), m), {});
    L.push(`- **Signals seen:** ${Object.entries(byLayer).map(([k, v]) => `${k} (${v})`).join(', ') || 'none'}`, '');
  }

  // Criteria mirror what verdictOf() actually gates on — no display-only rows that don't affect the
  // exit code (the old "Total < 10s" row was cosmetic and could disagree with the verdict).
  L.push('## Sign-off Criteria', '');
  L.push('| Criterion | Gate | Result |', '|-----------|------|--------|');
  if (hasBaseline) {
    const regr = incidents.filter((i) => i.vsBaseline && i.vsBaseline !== 'within').length;
    L.push(`| No regressions vs baseline | FAIL on new/worse | ${check(regr === 0)} ${regr} regression(s) |`);
  } else {
    const severe = incidents.filter((i) => i.severity === 'SEVERE').length;
    L.push(`| No freeze ≥3s and no crash | FAIL on any | ${check(severe === 0)} ${severe} severe |`);
  }
  L.push(`| Clean — no freezes at all | clean PASS | ${check(incidents.length === 0)} ${incidents.length} incident(s) |`);
  L.push(`| _Context (not a gate):_ longest ${fmtSec(a.longest)} · total frozen ${fmtSec(a.total)} | — | |`, '');

  if (a.layerFiles.length) {
    L.push('## Per-layer detail', '');
    L.push('Each layer that fired has its own report with every event and a pointer to its raw stream:', '');
    for (const l of a.layerFiles) L.push(`- [${LAYER_INFO[l].label}](layers/${l}.md)`);
    L.push('');
  }

  L.push('## Artifacts', '');
  L.push('- `report.html` — visual report (open in a browser)');
  if (a.artifacts.video) L.push('- `video.webm` — screen recording of the run');
  if (a.artifacts.trace) L.push('- `trace.json` — Chromium trace with CPU samples → load in `chrome://tracing`, Perfetto, or DevTools → Performance (import). The exact hung call stack is here, at the freeze timestamps above.');
  L.push('- Raw evidence: `freezes.jsonl`, `metrics.jsonl`, `actions.jsonl`, `renderer-tasks.jsonl`, `ipc.jsonl`, `breadcrumbs.jsonl` (the app’s own log lines)', '');
  L.push('---', `*Generated by electron-monitoring on ${meta.sessionStartIso.replace('T', ' ').slice(0, 19)}*`, '');
  return L.join('\n');
}

function renderHtml(a: {
  meta: ReportMeta; incidents: Incident[]; verdict: ReportResult['verdict'];
  longest: number; total: number; artifacts: { video: boolean; trace: boolean }; layerFiles: FreezeLayer[]; baselineLabel?: string;
  steps: StepMetrics[]; evidence: EvidenceSummary;
}): string {
  const { meta, incidents, verdict } = a;
  const sevClass = (s: Severity) => `sev-${s.toLowerCase()}`;
  const barMax = Math.max(a.longest, 1);
  const { signal } = rankIncidents(incidents);
  const top = signal[0];
  const startHere = top ? `
  <a class="starthere" href="#inc${incidents.indexOf(top)}">
    <span class="sh-tag">🔎 Start here</span>
    <span class="sh-body"><b>${esc(LAYER_INFO[primaryLayer(top)].label)}</b> during <b>${esc(top.action)}</b> — ${fmtS1(top.durationMs)}, ${top.severity}.
    <span class="sh-cause">${esc(culprit(top))}</span>
    <span class="sh-why">confidence ${confLabel(top)}: ${esc(top.confidenceReasons?.join(' · ') ?? '')}</span></span>
  </a>` : '';

  // Soft environmental note (mirrors the markdown report): a long-up host can cause freezes a fresh
  // boot wouldn't — shown only when uptime is high AND freezes occurred. Never changes the verdict.
  const envNote = (meta.hostUptimeSec != null && meta.hostUptimeSec > HIGH_UPTIME_SEC && incidents.length > 0)
    ? `<div class="envnote">⚠️ <b>Host has been up ${fmtUptime(meta.hostUptimeSec)}.</b> Long uptime can degrade a machine (memory fragmentation, leaked file descriptors, stale GPU/driver state); these freezes may reflect the environment, not the app. Re-run on a freshly-booted host to confirm.</div>`
    : '';

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
    const crumbs = i.breadcrumbs?.length
      ? `<div class="kv"><span>App logged just before</span><div><ul class="crumbs">${i.breadcrumbs
          .map((b) => `<li><time>${hhmmss(b.ts)}</time> <span class="lvl lvl-${esc(b.level)}">${esc(b.level)}</span> ${esc(b.text)}</li>`)
          .join('')}</ul></div></div>`
      : '';
    const deep = a.artifacts.trace
      ? `<div class="kv"><span>Dig deeper</span><div><code>trace.json</code> at <b>${hhmmss(i.startIso)}</b> → open in chrome://tracing / DevTools Performance for the exact call stack</div></div>`
      : '';
    const conf = `${confLabel(i)} · ${esc(i.confidenceReasons?.join(' · ') ?? '')}`;
    return `<section id="inc${n}" class="card ${sevClass(i.severity)}${i.noise ? ' noise' : ''}">
      <h3><span class="num">#${n + 1}</span> ${esc(LAYER_INFO[p].label)} · ${fmtS1(i.durationMs)} <span class="badge ${sevClass(i.severity)}">${i.severity}</span><span class="conf conf-${confLabel(i)}">${conf}</span>${i.vsBaseline ? `<span class="conf">${esc(baselineTag(i))}</span>` : ''}</h3>
      <div class="kv"><span>Triggered by</span><div><b>${esc(i.action)}</b> at ${hhmmss(i.startIso)}</div></div>
      <div class="kv"><span>Root cause</span><div class="cause">${esc(culprit(i))}</div></div>
      <div class="kv"><span>What happened</span><div>${esc(LAYER_INFO[p].what)}</div></div>
      <div class="kv"><span>CPU</span><div>${esc(cpuNote(i, meta.mainLayers))}</div></div>
      <div class="kv"><span>Next step</span><div class="fix">${esc(LAYER_INFO[p].fix)}</div></div>
      <div class="kv"><span>Look next</span><div class="look">${esc(whereToLookNext(i))}</div></div>
      <div class="kv"><span>Signals</span><div>${chips}<ul class="sig">${signals}</ul></div></div>
      ${crumbs}
      ${deep}
    </section>`;
  }).join('');

  const artLinks = [
    a.artifacts.video ? '<a href="video.webm">🎬 video.webm</a>' : '',
    a.artifacts.trace ? '<a href="trace.json">🔬 trace.json (chrome://tracing — call stacks)</a>' : '',
    '<a href="freezes.jsonl">freezes.jsonl</a>',
    '<a href="metrics.jsonl">metrics.jsonl</a>',
    '<a href="renderer-tasks.jsonl">renderer-tasks.jsonl</a>',
    '<a href="breadcrumbs.jsonl">breadcrumbs.jsonl</a>',
  ].filter(Boolean).join(' · ');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Electron Monitoring — Evidence Report</title><style>
  :root{--fg:#1f2937;--muted:#6b7280;--line:#e5e7eb;--bg:#eef1f6;--card:#fff;
        --sev:#dc2626;--mod:#d97706;--min:#6b7280;--ok:#16a34a;--accent:#2563eb}
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:var(--bg);color:var(--fg);line-height:1.5}
  .wrap{max-width:1100px;margin:0 auto;padding:24px}
  .banner{border-radius:14px;padding:20px 24px;color:#fff;margin-bottom:18px;box-shadow:0 4px 16px rgba(0,0,0,.10)}
  .banner h1{margin:0;font-size:1.4rem;letter-spacing:-.01em}.banner p{margin:.3rem 0 0;opacity:.95;font-size:.95rem}
  .banner .tag{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;opacity:.85;font-weight:700;margin-bottom:4px;display:block}
  .banner.PASS{background:linear-gradient(135deg,#16a34a,#15803d)}.banner.CAUTION{background:linear-gradient(135deg,#f59e0b,#d97706)}.banner.FAIL{background:linear-gradient(135deg,#ef4444,#b91c1c)}
  .meta{display:flex;flex-wrap:wrap;gap:8px 20px;font-size:.85rem;color:var(--muted);margin-bottom:22px}
  .meta b{color:var(--fg);font-weight:600}
  /* per-step lanes */
  .lanes{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 14px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
  .lane{display:flex;align-items:center;gap:12px;padding:6px 4px;border-bottom:1px solid #f1f3f7}
  .lane:last-child{border-bottom:none}
  .lane-name{width:170px;flex:none;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.9rem}
  .lane-track{flex:1;height:16px;background:#edf0f4;border-radius:8px;overflow:hidden;min-width:80px}
  .lane-fill{display:block;height:100%;border-radius:8px}
  .lane-fill.sev-severe{background:var(--sev)}.lane-fill.sev-moderate{background:var(--mod)}.lane-fill.sev-ok{background:#93c5a0}
  .lane-dur{width:64px;flex:none;text-align:right;font-variant-numeric:tabular-nums;font-weight:700;font-size:.85rem}
  .lane-chips{width:300px;flex:none;text-align:right}
  .dchip{display:inline-block;background:#eef2ff;color:#3730a3;border:1px solid #e0e7ff;border-radius:999px;padding:0 8px;font-size:.7rem;margin:1px 0 1px 4px}
  .dchip.froze{background:#fef2f2;color:#b91c1c;border-color:#fecaca}
  /* evidence panels */
  .panels{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:14px}
  .panel{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;box-shadow:0 1px 2px rgba(0,0,0,.04);overflow:hidden}
  .panel h3{margin:0 0 4px;font-size:1rem;display:flex;align-items:baseline;gap:8px}
  .panel h3 .big{font-size:1.5rem;font-weight:800;color:var(--accent)}
  .panel h4{margin:12px 0 4px;font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
  .panel .sub{margin:.1rem 0;font-size:.82rem;color:var(--muted)}
  .panel table{width:100%;border-collapse:collapse;font-size:.78rem;margin-top:4px}
  .panel th{text-align:left;color:var(--muted);font-weight:600;border-bottom:1px solid var(--line);padding:3px 6px 3px 0;white-space:nowrap}
  .panel td{padding:3px 6px 3px 0;border-bottom:1px solid #f4f6f9;vertical-align:top}
  .panel td code{font-size:.72rem;word-break:break-all;background:#f3f4f6;padding:1px 4px;border-radius:4px}
  .panel .errlist{margin:6px 0 0;padding-left:16px;font-size:.8rem}.panel .errlist li{margin-bottom:5px}
  .streams{font-size:.85rem}.streams a{color:var(--accent);text-decoration:none;font-family:ui-monospace,Menlo,monospace}.streams span{color:var(--muted)}
  .build-diff{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin-top:8px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
  .build-diff table{width:100%;border-collapse:collapse;font-size:.82rem;margin-top:8px}.build-diff th,.build-diff td{text-align:left;padding:4px 8px;border-bottom:1px solid var(--line)}
  .build-diff tr.reg{background:#fff7e6}.build-diff tr.sev{background:#fde7e7}.build-diff .notes{color:#888;font-size:.85em}.build-diff .verdict{font-size:.85rem;font-weight:700;margin-left:8px}
  .envnote{background:#fffbeb;border:1px solid #fde68a;border-left:4px solid var(--mod);color:#92400e;border-radius:10px;padding:10px 14px;margin:0 0 18px;font-size:.88rem}
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
  .fix{color:#1e40af}.look{color:#3730a3;font-size:.88rem}
  /* start-here callout */
  .starthere{display:flex;gap:14px;align-items:flex-start;background:#fffbeb;border:1px solid #fde68a;border-left:5px solid var(--mod);border-radius:12px;padding:14px 16px;margin:0 0 18px;text-decoration:none;color:inherit}
  .starthere:hover{background:#fef9e7}
  .sh-tag{flex:none;font-weight:800;color:var(--mod);white-space:nowrap}
  .sh-body{font-size:.95rem}.sh-cause{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82rem;margin-top:4px;word-break:break-all}
  .sh-why{display:block;color:var(--muted);font-size:.8rem;margin-top:2px}
  /* confidence chip */
  .conf{margin-left:auto;font-size:.7rem;font-weight:600;color:var(--muted)}
  .conf-high{color:var(--sev)}.conf-medium{color:var(--mod)}.conf-low{color:var(--muted)}
  .card.noise{opacity:.6}
  .perlayer{font-size:.9rem}.perlayer a{color:var(--accent);text-decoration:none;margin-right:10px}
  .chip{display:inline-block;background:#eef2ff;color:#3730a3;border:1px solid #e0e7ff;border-radius:999px;padding:1px 9px;font-size:.74rem;margin:0 4px 4px 0}
  ul.sig{margin:6px 0 0;padding-left:18px;font-size:.85rem;color:#374151}
  ul.sig code{font-size:.8rem}
  ul.crumbs{margin:4px 0 0;padding:8px 10px;list-style:none;background:#0f172a;color:#cbd5e1;border-radius:6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.8rem;line-height:1.7}
  ul.crumbs li{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  ul.crumbs time{color:#64748b}
  .lvl{display:inline-block;min-width:42px;text-align:center;border-radius:4px;padding:0 5px;margin:0 6px;font-size:.7rem;background:#334155;color:#e2e8f0}
  .lvl-error,.lvl-warning{background:#7f1d1d;color:#fecaca}
  .lvl-warn{background:#78350f;color:#fde68a}
  .arts{font-size:.88rem}.arts a{color:var(--accent);text-decoration:none;margin-right:4px}
  .empty{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:28px;text-align:center;color:var(--muted)}
  @media print{body{background:#fff}.tl-row:hover{background:none}.card{box-shadow:none}}
</style></head><body><div class="wrap">
  <div class="banner ${verdict}">
    <span class="tag">Electron Monitoring — Evidence Report</span>
    <h1>${VERDICT_EMOJI[verdict]} ${verdict} — ${esc(meta.appLabel)}${meta.appVersion ? ` v${esc(meta.appVersion)}` : ''}</h1>
    <p>${a.steps.length} step(s) traced · ${a.evidence.ipc.total.toLocaleString()} IPC messages · ${a.evidence.network.total} request(s) · ${incidents.length === 0 ? 'no freezes' : `${incidents.length} freeze${incidents.length > 1 ? 's' : ''} (worst ${fmtS1(a.longest)}, ${fmtS1(a.total)} total)`}</p>
  </div>
  <div class="meta">
    <span><b>App:</b> ${esc(meta.appLabel)}${meta.appVersion ? ` v${esc(meta.appVersion)}` : ''}</span>
    <span><b>Mode:</b> ${esc(meta.launchMode)}${meta.mainLayers ? '' : ' (renderer only — add --inspect for main-process layers)'}</span>
    <span><b>When:</b> ${hhmmss(meta.sessionStartIso)}–${hhmmss(meta.sessionEndIso)}</span>
    <span><b>Threshold:</b> ${meta.thresholdMs}ms</span>
    <span><b>Gate:</b> ${esc(a.baselineLabel ?? 'absolute (≥3s = FAIL)')}</span>
    ${meta.hostUptimeSec != null ? `<span><b>Host uptime:</b> ${fmtUptime(meta.hostUptimeSec)}</span>` : ''}
  </div>
  ${envNote}
  ${renderEvidenceHtml(a.steps, a.evidence)}
  <!--BUILDDIFF-->
  ${incidents.length === 0 ? '<div class="empty">🎉 Nothing froze. Nice.</div>' : `
  ${startHere}
  <h2>Timeline — which action froze, and for how long</h2>
  <div class="timeline">${timelineRows}</div>
  <h2>What froze &amp; how to fix it</h2>
  ${cards}`}
  ${a.layerFiles.length ? `<h2>Per-layer detail</h2><p class="perlayer">${a.layerFiles.map((l) => `<a href="layers/${l}.md">${esc(LAYER_INFO[l].label)}</a>`).join('')}</p>` : ''}
  <h2>Artifacts</h2>
  <p class="arts">${artLinks}</p>
</div></body></html>`;
}
