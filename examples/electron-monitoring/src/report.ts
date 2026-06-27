import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { severityFor, type FreezeEvent, type FreezeLayer, type Severity } from './freezeBus.js';
import type { ActionWindow } from './currentAction.js';
import { correlate } from './correlator.js';

// Reads the JSONL evidence streams a run produced, merges overlapping detector events into
// freeze "incidents", attributes each to a UI action, computes the verdict + exit code
// (mirrors process-watchdog/ReportWriter.cs) and writes the Markdown sign-off + HTML timeline.

interface MetricSample { ts: string; samples: { pid: number; type: string; cpu: number; mem: number }[] }

export interface Incident {
  startIso: string; endIso: string; durationMs: number;
  layers: FreezeLayer[]; severity: Severity; peakCpuPct: number;
  action: string; events: FreezeEvent[];
}

export interface ReportMeta {
  sessionStartIso: string; sessionEndIso: string;
  appLabel: string; launchMode: string; thresholdMs: number; loafSupported: boolean;
  /** whether the main-process layers (L3/L4/L5) were reachable this run */
  mainLayers: boolean;
}

export interface ReportResult {
  verdict: 'PASS' | 'CAUTION' | 'FAIL'; exitCode: number;
  mdPath: string; htmlPath: string; incidents: Incident[];
}

const SEV_RANK: Record<Severity, number> = { MINOR: 0, MODERATE: 1, SEVERE: 2 };

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
}

/** Merge detector events whose time windows overlap (within gapMs) into single incidents. */
export function mergeIncidents(freezes: FreezeEvent[], gapMs = 500): Incident[] {
  const sorted = [...freezes].sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso));
  const incidents: Incident[] = [];
  for (const f of sorted) {
    const start = Date.parse(f.startIso);
    const end = start + f.durationMs;
    const cur = incidents[incidents.length - 1];
    const curEnd = cur ? Date.parse(cur.endIso) : -Infinity;
    if (cur && start <= curEnd + gapMs) {
      if (end > curEnd) cur.endIso = new Date(end).toISOString();
      cur.durationMs = Date.parse(cur.endIso) - Date.parse(cur.startIso);
      if (!cur.layers.includes(f.layer)) cur.layers.push(f.layer);
      cur.events.push(f);
      if (cur.action === '(idle / between steps)' && f.action) cur.action = f.action;
    } else {
      incidents.push({
        startIso: f.startIso, endIso: new Date(end).toISOString(), durationMs: f.durationMs,
        layers: [f.layer], severity: f.severity, peakCpuPct: 0,
        action: f.action ?? '(idle / between steps)', events: [f],
      });
    }
  }
  // incident severity = worst of (span-based, any constituent event e.g. a crash)
  for (const inc of incidents) {
    const bySpan = severityFor(inc.durationMs);
    const byEvent = inc.events.reduce<Severity>((a, e) => (SEV_RANK[e.severity] > SEV_RANK[a] ? e.severity : a), 'MINOR');
    inc.severity = SEV_RANK[bySpan] >= SEV_RANK[byEvent] ? bySpan : byEvent;
  }
  return incidents;
}

function peakCpu(inc: Incident, metrics: MetricSample[]): number {
  const lo = Date.parse(inc.startIso) - 500;
  const hi = Date.parse(inc.endIso) + 500;
  let peak = 0;
  for (const m of metrics) {
    const t = Date.parse(m.ts);
    if (t < lo || t > hi) continue;
    for (const s of m.samples ?? []) if (s.cpu > peak) peak = s.cpu;
  }
  return +peak.toFixed(1);
}

function verdictOf(incidents: Incident[]): { verdict: ReportResult['verdict']; exitCode: number } {
  if (incidents.length === 0) return { verdict: 'PASS', exitCode: 0 };
  if (incidents.some((i) => i.severity === 'SEVERE')) return { verdict: 'FAIL', exitCode: 2 };
  return { verdict: 'CAUTION', exitCode: 1 };
}

const fmtSec = (ms: number) => (ms / 1000).toFixed(3) + 's';
function fmtDur(ms: number): string {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60);
  if (h >= 1) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m >= 1) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
const VERDICT_EMOJI = { PASS: '✅', CAUTION: '⚠️', FAIL: '❌' } as const;
const check = (ok: boolean) => (ok ? '✅' : '❌');
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
function stamp(iso: string): string {
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Read a run's evidence and write report.md + report.html. Returns verdict + exit code for CI. */
export function buildReport(runDir: string, meta: ReportMeta): ReportResult {
  const rawFreezes = readJsonl<FreezeEvent>(join(runDir, 'freezes.jsonl'));
  const actions = readJsonl<ActionWindow>(join(runDir, 'actions.jsonl'));
  const metrics = readJsonl<MetricSample>(join(runDir, 'metrics.jsonl'));

  const correlated = correlate(rawFreezes, actions);
  const incidents = mergeIncidents(correlated);
  for (const inc of incidents) inc.peakCpuPct = peakCpu(inc, metrics);

  const { verdict, exitCode } = verdictOf(incidents);
  const longest = incidents.reduce((a, i) => Math.max(a, i.durationMs), 0);
  const total = incidents.reduce((a, i) => a + i.durationMs, 0);
  const avg = incidents.length ? total / incidents.length : 0;

  const artifacts = {
    video: existsSync(join(runDir, 'video.webm')),
    trace: existsSync(join(runDir, 'trace.json')),
  };
  const md = renderMarkdown({ meta, incidents, verdict, longest, total, avg, rawFreezes, artifacts });
  const html = renderHtml({ meta, incidents, verdict, longest, total, actions, artifacts });

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
  L.push(`| Session Start | ${start.toTimeString().slice(0, 8)} |`);
  L.push(`| Session End | ${end.toTimeString().slice(0, 8)} |`);
  L.push(`| Duration | ${fmtDur(end.getTime() - start.getTime())} |`);
  L.push(`| App | ${meta.appLabel} |`);
  L.push(`| Launch Mode | ${meta.launchMode}${meta.mainLayers ? '' : ' (main-process layers L3/L4/L5 unavailable)'} |`);
  L.push(`| Main-process layers | ${meta.mainLayers ? 'available' : 'unavailable (plain cdp — add --inspect)'} |`);
  L.push(`| LoAF attribution | ${meta.loafSupported ? 'available' : 'unavailable (longtask only)'} |`);
  L.push(`| Freeze Threshold | ${meta.thresholdMs}ms |`);
  L.push(`| **Verdict** | **${VERDICT_EMOJI[verdict]} ${verdict}** |`, '');

  if (incidents.length === 0) {
    L.push('## Result', '', 'No freeze events detected during the session.', '');
  } else {
    L.push('## Freeze Events', '');
    L.push('| # | Start | Duration | Peak CPU% | Triggering Action | Layer(s) | Severity |');
    L.push('|---|-------|----------|-----------|-------------------|----------|----------|');
    incidents.forEach((i, n) => {
      L.push(`| ${n + 1} | ${new Date(i.startIso).toTimeString().slice(0, 8)} | ${fmtSec(i.durationMs)} | ${i.peakCpuPct}% | ${i.action} | ${i.layers.join(', ')} | ${i.severity} |`);
    });
    L.push('', '## Summary', '');
    L.push(`- **Freeze count:** ${incidents.length}`);
    L.push(`- **Total freeze time:** ${fmtSec(a.total)}`);
    L.push(`- **Longest freeze:** ${fmtSec(a.longest)}`);
    L.push(`- **Average freeze:** ${fmtSec(a.avg)}`);
    const byLayer = a.rawFreezes.reduce<Record<string, number>>((m, e) => ((m[e.layer] = (m[e.layer] ?? 0) + 1), m), {});
    L.push(`- **Per-layer detections:** ${Object.entries(byLayer).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`);
    const highCpu = incidents.filter((i) => i.peakCpuPct >= 80).length;
    L.push(highCpu > 0
      ? `- **CPU correlation:** ${highCpu}/${incidents.length} freezes had CPU ≥ 80% (busy compute — expected during heavy work)`
      : `- **CPU correlation:** low CPU during freezes — investigate possible deadlock or I/O wait`);
    L.push('');
  }

  L.push('## Sign-off Criteria', '');
  L.push('| Criterion | Threshold | Result |', '|-----------|-----------|--------|');
  L.push(`| No freeze events | 0 | ${check(incidents.length === 0)} ${incidents.length} event(s) |`);
  L.push(`| Longest freeze < 3s | < 3s | ${check(a.longest < 3000)} ${fmtSec(a.longest)} |`);
  L.push(`| Total freeze time < 10s | < 10s | ${check(a.total < 10000)} ${fmtSec(a.total)} |`, '');

  L.push('## Artifacts', '');
  L.push('- `report.html` — visual freeze timeline (open in a browser)');
  if (a.artifacts.video) L.push('- `video.webm` — screen recording of the run');
  if (a.artifacts.trace) L.push('- `trace.json` — Chromium trace with embedded CPU samples (load in `chrome://tracing`, Perfetto, or DevTools → Performance → import) — the hung call stack is here');
  L.push('- Raw evidence: `freezes.jsonl`, `metrics.jsonl`, `actions.jsonl`, `renderer-tasks.jsonl`', '');
  L.push('---', `*Generated by electron-monitoring on ${meta.sessionStartIso.replace('T', ' ').slice(0, 19)}*`, '');
  return L.join('\n');
}

function renderHtml(a: {
  meta: ReportMeta; incidents: Incident[]; verdict: ReportResult['verdict'];
  longest: number; total: number; actions: ActionWindow[];
  artifacts: { video: boolean; trace: boolean };
}): string {
  const { meta, incidents, verdict, actions } = a;
  const t0 = Date.parse(meta.sessionStartIso);
  const span = Math.max(1, Date.parse(meta.sessionEndIso) - t0);
  const pct = (ms: number) => Math.max(0, Math.min(100, ((ms - t0) / span) * 100));
  const width = (durMs: number) => Math.max(0.4, (durMs / span) * 100);

  const actionBars = actions.map((w) =>
    `<div class="bar action" style="left:${pct(Date.parse(w.startIso))}%;width:${width(Date.parse(w.endIso) - Date.parse(w.startIso))}%" title="${esc(w.name)}">${esc(w.name)}</div>`,
  ).join('');

  const freezeBars = incidents.map((i, n) =>
    `<a class="bar freeze sev-${i.severity}" href="#inc${n}" style="left:${pct(Date.parse(i.startIso))}%;width:${width(i.durationMs)}%" title="${esc(i.action)} — ${fmtSec(i.durationMs)}">${fmtSec(i.durationMs)}</a>`,
  ).join('');

  const detail = incidents.map((i, n) => {
    const evRows = i.events.map((e) => {
      const d = e.detail;
      if (e.layer === 'renderer-task' && Array.isArray(d.scripts) && d.scripts.length) {
        const scripts = (d.scripts as { sourceURL: string; functionName: string; charPos: number; duration: number }[])
          .map((s) => `<li><code>${esc(s.sourceURL || '(inline)')}</code> → <b>${esc(s.functionName || '(anon)')}</b> @${s.charPos} · ${Math.round(s.duration)}ms</li>`).join('');
        return `<div class="ev"><b>${e.layer}</b> (${d.kind}) blocking ${e.durationMs}ms<ul>${scripts}</ul></div>`;
      }
      return `<div class="ev"><b>${e.layer}</b> ${e.durationMs}ms — <code>${esc(JSON.stringify(d))}</code></div>`;
    }).join('');
    return `<details id="inc${n}" class="card sev-${i.severity}"><summary>#${n + 1} · ${esc(i.action)} · ${fmtSec(i.durationMs)} · ${i.severity} · peak CPU ${i.peakCpuPct}%</summary>
      <div class="layers">layers: ${i.layers.join(', ')}</div>${evRows}</details>`;
  }).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Freeze Report</title><style>
  body{font-family:system-ui,sans-serif;margin:0;background:#161616;color:#e6e6e6}
  .wrap{max-width:1100px;margin:0 auto;padding:1.5rem}
  .banner{padding:1rem 1.25rem;border-radius:8px;font-size:1.4rem;font-weight:700;margin-bottom:1rem}
  .PASS{background:#14532d}.CAUTION{background:#854d0e}.FAIL{background:#7f1d1d}
  .cards{display:flex;gap:.75rem;flex-wrap:wrap;margin-bottom:1.5rem}
  .stat{background:#222;border:1px solid #333;border-radius:8px;padding:.75rem 1rem;min-width:130px}
  .stat .n{font-size:1.5rem;font-weight:700}.stat .l{color:#999;font-size:.8rem}
  h2{font-size:1rem;color:#aaa;border-bottom:1px solid #333;padding-bottom:.3rem}
  .timeline{position:relative;margin:.5rem 0 2rem}
  .track{position:relative;height:34px;margin:.3rem 0;background:#1d1d1d;border-radius:4px}
  .track .lbl{position:absolute;left:6px;top:8px;color:#666;font-size:.7rem;z-index:0}
  .bar{position:absolute;top:3px;height:28px;border-radius:3px;font-size:.7rem;line-height:28px;
    padding:0 4px;overflow:hidden;white-space:nowrap;box-sizing:border-box;color:#fff;text-decoration:none}
  .bar.action{background:#1e3a5f;border:1px solid #2d5a8f}
  .bar.freeze{background:#b91c1c;border:1px solid #ef4444;font-weight:700}
  .bar.freeze.sev-MODERATE{background:#a16207;border-color:#eab308}
  .bar.freeze.sev-MINOR{background:#555}
  details.card{background:#1e1e1e;border:1px solid #333;border-left-width:4px;border-radius:6px;margin:.5rem 0;padding:.5rem .75rem}
  details.sev-SEVERE{border-left-color:#ef4444}details.sev-MODERATE{border-left-color:#eab308}details.sev-MINOR{border-left-color:#666}
  summary{cursor:pointer;font-weight:600}.layers{color:#888;font-size:.8rem;margin:.4rem 0}
  .ev{margin:.4rem 0;font-size:.85rem}.ev code{color:#9cdcfe;word-break:break-all}.ev ul{margin:.2rem 0 .2rem 1rem}
  a.foot{color:#6cf}</style></head><body><div class="wrap">
  <div class="banner ${verdict}">${VERDICT_EMOJI[verdict]} ${verdict} — ${incidents.length} freeze incident(s)</div>
  <div class="cards">
    <div class="stat"><div class="n">${incidents.length}</div><div class="l">incidents</div></div>
    <div class="stat"><div class="n">${fmtSec(a.longest)}</div><div class="l">longest freeze</div></div>
    <div class="stat"><div class="n">${fmtSec(a.total)}</div><div class="l">total frozen</div></div>
    <div class="stat"><div class="n">${esc(meta.launchMode)}</div><div class="l">launch mode</div></div>
  </div>
  <h2>Timeline — which action froze</h2>
  <div class="timeline">
    <div class="track"><span class="lbl">UI actions</span>${actionBars}</div>
    <div class="track"><span class="lbl">freezes</span>${freezeBars}</div>
  </div>
  <h2>Incidents</h2>
  ${detail || '<p>No freezes detected. 🎉</p>'}
  <h2>Artifacts</h2>
  <p>${a.artifacts.video ? '<a class="foot" href="video.webm">video.webm</a> · ' : ''}${a.artifacts.trace ? '<a class="foot" href="trace.json">trace.json</a> (chrome://tracing — embedded CPU samples) · ' : ''}<a class="foot" href="freezes.jsonl">freezes.jsonl</a> ·
     <a class="foot" href="metrics.jsonl">metrics.jsonl</a> ·
     <a class="foot" href="renderer-tasks.jsonl">renderer-tasks.jsonl</a></p>
  </div></body></html>`;
}
