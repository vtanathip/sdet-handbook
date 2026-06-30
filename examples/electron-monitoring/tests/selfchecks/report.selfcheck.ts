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
  assert.ok(html.includes('Host uptime') && html.includes('40d'), 'html shows host uptime as run context');
  assert.ok(html.includes('envnote') && html.includes('Host has been up'),
    'high uptime + freezes surfaces the soft environmental note in html');

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

  // Build-vs-build baseline: record the OLD build's run as a build-baseline (per-step), then the NEW
  // build's report loads it and embeds the comparison inline, gating on per-step TIMING regression
  // (even with no freeze). Same scenario step 'load' run on both builds.
  const gdir = mkdtempSync(join(tmpdir(), 'em-old-'));
  const gmeta = { sessionStartIso: iso(0), sessionEndIso: iso(5000), appLabel: './demo-app', launchMode: 'source', thresholdMs: 200, loafSupported: true, mainLayers: true };
  writeFileSync(join(gdir, 'actions.jsonl'), JSON.stringify({ name: 'load', startIso: iso(0), endIso: iso(1000) }) + '\n');
  const baselinePath = join(gdir, 'build-baseline.json');
  try {
    process.env.SAVE_BASELINE = baselinePath;
    buildReport(gdir, gmeta);
    delete process.env.SAVE_BASELINE;
    assert.ok(existsSync(baselinePath), 'the old build records build-baseline.json');
    assert.ok(JSON.parse(readFileSync(baselinePath, 'utf8')).steps, 'build-baseline holds per-step metrics');

    process.env.BASELINE_FILE = baselinePath;

    // New build: same step but 2.5× slower, no freeze → freeze verdict PASS, but the build diff cautions.
    const ndir = mkdtempSync(join(tmpdir(), 'em-new-'));
    writeFileSync(join(ndir, 'actions.jsonl'), JSON.stringify({ name: 'load', startIso: iso(0), endIso: iso(2500) }) + '\n');
    const slower = buildReport(ndir, gmeta);
    assert.equal(slower.verdict, 'CAUTION', 'a per-step timing regression gates CI even with no freeze');
    const nmd = readFileSync(slower.mdPath, 'utf8');
    assert.ok(nmd.includes('Build Comparison'), 'the new build report embeds the build comparison');
    assert.ok(/load/.test(nmd) && nmd.includes('slower'), 'the slowed step is named as slower');

    // New build: same step within tolerance → no regression → PASS.
    const cdir = mkdtempSync(join(tmpdir(), 'em-clean-'));
    writeFileSync(join(cdir, 'actions.jsonl'), JSON.stringify({ name: 'load', startIso: iso(0), endIso: iso(1050) }) + '\n');
    const clean = buildReport(cdir, gmeta);
    assert.equal(clean.verdict, 'PASS', 'within-tolerance timing → PASS');
    assert.ok(readFileSync(clean.mdPath, 'utf8').includes('Build Comparison'), 'report still shows the comparison section');
  } finally {
    delete process.env.SAVE_BASELINE;
    delete process.env.BASELINE_FILE;
  }
}
