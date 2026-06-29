import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildReport } from '../../src/report.js';

// End-to-end report: two overlapping events (a 4.2s heartbeat freeze + its LoAF attribution) merge
// into one SEVERE incident → verdict FAIL / exit 2, with the action + script attribution rendered.
export function run(): void {
  const dir = mkdtempSync(join(tmpdir(), 'em-selfcheck-'));
  const base = Date.parse('2026-06-27T10:00:00.000Z');
  const iso = (o: number) => new Date(base + o).toISOString();

  writeFileSync(join(dir, 'actions.jsonl'),
    JSON.stringify({ name: 'click Freeze 4s', startIso: iso(100), endIso: iso(4400) }) + '\n');
  writeFileSync(join(dir, 'freezes.jsonl'),
    JSON.stringify({ layer: 'renderer-heartbeat', startIso: iso(150), durationMs: 4200, severity: 'SEVERE', detail: { gapMs: 4200 } }) + '\n' +
    JSON.stringify({ layer: 'renderer-task', startIso: iso(160), durationMs: 4100, severity: 'SEVERE', detail: { kind: 'loaf', scripts: [{ sourceURL: 'app.js', functionName: 'onClick', charPos: 42, duration: 4100 }] } }) + '\n');
  writeFileSync(join(dir, 'metrics.jsonl'),
    JSON.stringify({ ts: iso(2000), samples: [{ pid: 1, type: 'Tab', cpu: 96, mem: 1000 }] }) + '\n');
  // App-domain breadcrumbs: one just before the freeze (kept), one 5 min earlier (out of window).
  writeFileSync(join(dir, 'breadcrumbs.jsonl'),
    JSON.stringify({ ts: iso(-300_000), where: 'renderer', level: 'log', text: 'app started' }) + '\n' +
    JSON.stringify({ ts: iso(120), where: 'renderer', level: 'log', text: 'rendering invoice #4821' }) + '\n');

  const result = buildReport(dir, {
    sessionStartIso: iso(0), sessionEndIso: iso(5000),
    appLabel: './demo-app', launchMode: 'source', thresholdMs: 200, loafSupported: true, mainLayers: true,
    hostUptimeSec: 40 * 24 * 3600, // 40d up + freezes → the soft environmental note should appear
  });

  assert.equal(result.verdict, 'FAIL', 'a 4.2s freeze is FAIL');
  assert.equal(result.exitCode, 2);
  assert.equal(result.incidents.length, 1, 'overlapping events merge into one incident');
  assert.deepEqual([...result.incidents[0].layers].sort(), ['renderer-heartbeat', 'renderer-task']);
  assert.equal(result.incidents[0].peakCpuPct, 96, 'peak CPU pulled from metrics window');
  assert.deepEqual(result.incidents[0].breadcrumbs?.map((b) => b.text), ['rendering invoice #4821'],
    'only the in-window breadcrumb is attached (the 5-min-old one is dropped)');

  const md = readFileSync(result.mdPath, 'utf8');
  assert.ok(md.includes('click Freeze 4s'), 'md has triggering action');
  assert.ok(md.includes('FAIL'), 'md has verdict');
  assert.ok(md.includes('## Diagnosis'), 'md has plain-English diagnosis');
  assert.ok(md.includes('onClick'), 'md has root-cause script attribution');
  assert.ok(md.includes('Next step:'), 'md has a fix suggestion');
  assert.ok(md.includes('rendering invoice #4821'), 'md shows app-domain breadcrumbs before the freeze');
  assert.ok(md.includes('Host uptime | 40d'), 'md shows host uptime as run context');
  assert.ok(md.includes('Host has been up') && md.includes('environment, not the app'),
    'high uptime + freezes surfaces the soft environmental note');

  const html = readFileSync(result.htmlPath, 'utf8');
  assert.ok(html.includes('tl-fill'), 'html has the timeline');
  assert.ok(html.includes('class="card'), 'html has freeze cards');
  assert.ok(html.includes('click Freeze 4s'), 'html names the triggering action');
  assert.ok(html.includes('onClick'), 'html has root-cause script attribution');
  assert.ok(html.includes('Next step'), 'html has a fix suggestion');
  assert.ok(html.includes('rendering invoice #4821'), 'html shows app-domain breadcrumbs');

  // Highlighting + the culprit fix: a main-loop freeze must name its HANDLER as the root cause (not a
  // renderer offset), a high-confidence freeze must rank above demoted noise, and per-layer reports
  // must be written.
  const dir2 = mkdtempSync(join(tmpdir(), 'em-selfcheck2-'));
  writeFileSync(join(dir2, 'actions.jsonl'),
    JSON.stringify({ name: 'click Main busy', startIso: iso(100), endIso: iso(3200) }) + '\n');
  writeFileSync(join(dir2, 'freezes.jsonl'),
    // a real bug: main loop blocked by a named handler, corroborated, tied to a click
    JSON.stringify({ layer: 'main-loop', startIso: iso(150), durationMs: 3000, severity: 'SEVERE', detail: { maxLagMs: 3000, blockingChannel: 'reconcile-ledger', blockingKind: 'handle', blockingMs: 2950 } }) + '\n' +
    JSON.stringify({ layer: 'renderer-heartbeat', startIso: iso(160), durationMs: 3000, severity: 'SEVERE', detail: { gapMs: 3000, route: '/ledger' } }) + '\n' +
    // pure noise: a lone idle console.error
    JSON.stringify({ layer: 'js-error', startIso: iso(60_000), durationMs: 0, severity: 'MINOR', detail: { kind: 'console.error', where: 'renderer', message: 'tidy up later' } }) + '\n');

  const r2 = buildReport(dir2, {
    sessionStartIso: iso(0), sessionEndIso: iso(70_000),
    appLabel: './demo-app', launchMode: 'source', thresholdMs: 200, loafSupported: true, mainLayers: true,
  });
  const md2 = readFileSync(r2.mdPath, 'utf8');
  assert.ok(md2.includes("reconcile-ledger"), 'main-loop root cause names the blocking handler');
  assert.ok(md2.includes('🔎 Start here'), 'report highlights the most likely bug');
  assert.ok(md2.includes('Where to look next'), 'report tells you where to drill in');
  assert.ok(md2.includes('Likely noise'), 'low-confidence blips are demoted, not mixed in');
  // the idle console.error must be in the noise bucket, the real freeze in the priority list
  assert.ok(md2.indexOf('Start here') < md2.indexOf('Likely noise'), 'noise sorted below the real bug');
  assert.ok(existsSync(join(dir2, 'layers', 'main-loop.md')), 'per-layer detail report is written');

  // Baseline: gate on REGRESSION vs a known-good run, not a static absolute. Record a green run
  // (worst renderer-task = 2.0s), then a within-envelope run passes and a materially-worse run fails.
  const gdir = mkdtempSync(join(tmpdir(), 'em-green-'));
  const gmeta = { sessionStartIso: iso(0), sessionEndIso: iso(5000), appLabel: './demo-app', launchMode: 'source', thresholdMs: 200, loafSupported: true, mainLayers: true };
  const script = (ms: number, sev: string) =>
    JSON.stringify({ layer: 'renderer-task', startIso: iso(150), durationMs: ms, severity: sev, detail: { kind: 'loaf', scripts: [{ sourceURL: 'app.js', functionName: 'render', charPos: 1, duration: ms }] } }) + '\n';
  writeFileSync(join(gdir, 'freezes.jsonl'), script(2000, 'MODERATE'));
  const baselinePath = join(gdir, 'baseline.json');
  try {
    process.env.SAVE_BASELINE = baselinePath;
    buildReport(gdir, gmeta);
    delete process.env.SAVE_BASELINE;
    assert.ok(existsSync(baselinePath), 'a green run records baseline.json');

    process.env.BASELINE_FILE = baselinePath;

    const wdir = mkdtempSync(join(tmpdir(), 'em-within-'));
    writeFileSync(join(wdir, 'freezes.jsonl'), script(1900, 'MODERATE')); // ≤ 2.0s × 1.2 → within
    const within = buildReport(wdir, gmeta);
    assert.equal(within.incidents[0].vsBaseline, 'within', 'a 1.9s freeze is within the 2.0s baseline envelope');
    assert.equal(within.verdict, 'PASS', 'within-baseline → PASS (no regression), even though absolute rules would CAUTION');

    const bdir = mkdtempSync(join(tmpdir(), 'em-worse-'));
    writeFileSync(join(bdir, 'freezes.jsonl'), script(5000, 'SEVERE')); // » 2.0s × 1.2 → worse
    const worse = buildReport(bdir, gmeta);
    assert.equal(worse.incidents[0].vsBaseline, 'worse', 'a 5s freeze is materially worse than baseline');
    assert.equal(worse.verdict, 'FAIL', 'a regression (worse than green) + SEVERE → FAIL');
    assert.ok(readFileSync(worse.mdPath, 'utf8').includes('Vs baseline'), 'report shows the baseline comparison');
  } finally {
    delete process.env.SAVE_BASELINE;
    delete process.env.BASELINE_FILE;
  }
}
