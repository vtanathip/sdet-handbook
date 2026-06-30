import { existsSync, readFileSync } from 'node:fs';

// Differential flamegraph from the V8 CPU samples in two trace.json files (old build vs new build).
// We fold each trace into inclusive CPU time per function, then diff: which functions burn MORE CPU in
// the new build. This replaces the single-run timeline with the question a perf sign-off actually asks —
// "where did the time go between versions?". Rendered as a flamegraph-style bar chart (red = slower).

interface CallFrame { functionName?: string; url?: string; lineNumber?: number }
interface ProfNode { id: number; callFrame: CallFrame; parent?: number }

function basename(u?: string): string {
  if (!u) return '';
  const s = u.split(/[\\/]/); return s[s.length - 1] || u;
}
function frameKey(cf: CallFrame): string {
  const fn = cf.functionName || '(anonymous)';
  const loc = cf.url ? ` ${basename(cf.url)}${cf.lineNumber != null ? ':' + (cf.lineNumber + 1) : ''}` : '';
  return fn + loc;
}

/** Fold a trace.json into inclusive CPU time (ms) per function. Returns null if it has no CPU profile. */
function foldTrace(path: string): Map<string, number> | null {
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
  const events = (Array.isArray(parsed) ? parsed : (parsed as { traceEvents?: unknown[] }).traceEvents) ?? [];

  const nodes = new Map<number, ProfNode>();
  const samples: number[] = [];
  const deltas: number[] = [];
  for (const e of events as { name?: string; args?: { data?: { cpuProfile?: { nodes?: ProfNode[]; samples?: number[] }; timeDeltas?: number[] } } }[]) {
    if (e.name !== 'ProfileChunk' && e.name !== 'CpuProfile') continue;
    const cp = e.args?.data?.cpuProfile;
    if (!cp) continue;
    for (const n of cp.nodes ?? []) if (n && n.id != null) nodes.set(n.id, n);
    for (const s of cp.samples ?? []) samples.push(s);
    for (const dt of e.args?.data?.timeDeltas ?? []) deltas.push(dt);
  }
  if (nodes.size === 0 || samples.length === 0) return null;

  const incl = new Map<string, number>();
  for (let i = 0; i < samples.length; i++) {
    const dtMs = (deltas[i] ?? 0) / 1000; // µs → ms
    if (dtMs <= 0) continue;
    // Walk node→parent; add the sample's time to each DISTINCT function in the stack (inclusive time).
    const seen = new Set<string>();
    let n: ProfNode | undefined = nodes.get(samples[i]);
    let guard = 0;
    while (n && guard++ < 1024) {
      const k = frameKey(n.callFrame);
      if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) ?? 0) + dtMs); }
      n = n.parent != null ? nodes.get(n.parent) : undefined;
    }
  }
  return incl;
}

export interface FlameRow { fn: string; oldMs: number; newMs: number; deltaMs: number }
export interface FlameDiff { rows: FlameRow[]; oldTotal: number; newTotal: number }

// Ignore V8's synthetic frames + the measurement apparatus itself (Playwright's injected hit-target
// interceptors, our own heartbeat/probe globals, undici/node HTTP internals) — they're observer-effect
// noise, not the app's code. On a real app this barely matters; on the near-idle demo it dominates.
const SYNTHETIC = /^\((root|program|idle|garbage collector)\)/;
const NOISE = /^(InjectedScript|_?setupHitTargetInterceptors|addHitTargetInterceptorListeners|_?expectHitTarget|hitTargetInterceptor|__hb|__elt|__ipc|raf|tick|evaluate|parseEvaluationResultValue|requireBuiltin|compileForInternalLoader)\b|undici|\bnode:| (realm|util|browser_init|bootstrap_node|inspector_async_hook|assertion_error):/;

export function diffFlamegraph(oldPath: string, newPath: string): FlameDiff | null {
  const o = foldTrace(oldPath), n = foldTrace(newPath);
  if (!o || !n) return null;
  const keys = new Set([...o.keys(), ...n.keys()]);
  const rows: FlameRow[] = [];
  for (const fn of keys) {
    if (SYNTHETIC.test(fn) || NOISE.test(fn)) continue;
    const oldMs = Math.round(o.get(fn) ?? 0), newMs = Math.round(n.get(fn) ?? 0);
    rows.push({ fn, oldMs, newMs, deltaMs: newMs - oldMs });
  }
  rows.sort((a, b) => b.deltaMs - a.deltaMs);
  const sum = (m: Map<string, number>): number => [...m.values()].reduce((a, b) => a + b, 0);
  return { rows, oldTotal: Math.round(sum(o)), newTotal: Math.round(sum(n)) };
}

// Top regressions + top improvements, above a noise floor.
function topRows(d: FlameDiff, floorMs = 20, n = 20): FlameRow[] {
  const slower = d.rows.filter((r) => r.deltaMs >= floorMs).slice(0, n);
  const faster = d.rows.filter((r) => r.deltaMs <= -floorMs).slice(-5);
  return [...slower, ...faster];
}

export function renderFlameMarkdown(d: FlameDiff): string {
  const rows = topRows(d);
  if (rows.length === 0) return '## Hot-path diff\n\nNo function moved CPU time materially between builds.\n';
  const L: string[] = ['## Hot-path diff (CPU time, candidate vs previous)', '',
    `Total sampled CPU: ${d.oldTotal}ms → ${d.newTotal}ms`, '', '| Function | Previous | Candidate | Δ |', '|---|---|---|---|'];
  for (const r of rows) L.push(`| \`${r.fn}\` | ${r.oldMs}ms | ${r.newMs}ms | ${r.deltaMs >= 0 ? '+' : ''}${r.deltaMs}ms |`);
  L.push('');
  return L.join('\n');
}

export function renderFlameHtml(d: FlameDiff): string {
  const rows = topRows(d);
  if (rows.length === 0) return '';
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.deltaMs)));
  const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const bars = rows.map((r) => {
    const w = Math.max(2, Math.round((Math.abs(r.deltaMs) / max) * 100));
    const slower = r.deltaMs >= 0;
    return `<div class="frow"><span class="ffn" title="${esc(r.fn)}">${esc(r.fn)}</span>
      <span class="ftrack"><span class="ffill ${slower ? 'slow' : 'fast'}" style="width:${w}%"></span></span>
      <span class="fdelta ${slower ? 'slow' : 'fast'}">${r.deltaMs >= 0 ? '+' : ''}${r.deltaMs}ms</span>
      <span class="fnums">${r.oldMs}→${r.newMs}ms</span></div>`;
  }).join('');
  return `<h2>Hot-path diff — where the CPU time moved</h2>
  <div class="card flame"><p class="legend">Total sampled CPU ${d.oldTotal}ms → ${d.newTotal}ms · 🔴 slower in candidate · 🟢 faster. Inclusive time per function (from trace.json CPU samples).</p>
  ${bars}</div>
  <style>
  .flame{padding:12px 16px}.frow{display:flex;align-items:center;gap:10px;padding:4px 0;font-size:.82rem}
  .ffn{width:300px;flex:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:ui-monospace,Menlo,monospace}
  .ftrack{flex:1;height:14px;background:#f1f3f7;border-radius:7px;overflow:hidden;min-width:60px}
  .ffill{display:block;height:100%;border-radius:7px}.ffill.slow{background:#dc2626}.ffill.fast{background:#16a34a}
  .fdelta{width:72px;flex:none;text-align:right;font-weight:700;font-variant-numeric:tabular-nums}.fdelta.slow{color:#b91c1c}.fdelta.fast{color:#15803d}
  .fnums{width:96px;flex:none;text-align:right;color:#6b7280;font-variant-numeric:tabular-nums}</style>`;
}

/** Convenience for the compare CLI: returns an HTML fragment ('' if no usable CPU profile in both). */
export function diffFlamegraphHtml(oldPath: string, newPath: string): string {
  const d = diffFlamegraph(oldPath, newPath);
  return d ? renderFlameHtml(d) : '';
}
