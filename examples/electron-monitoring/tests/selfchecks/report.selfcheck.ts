import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

  const result = buildReport(dir, {
    sessionStartIso: iso(0), sessionEndIso: iso(5000),
    appLabel: './demo-app', launchMode: 'source', thresholdMs: 200, loafSupported: true,
  });

  assert.equal(result.verdict, 'FAIL', 'a 4.2s freeze is FAIL');
  assert.equal(result.exitCode, 2);
  assert.equal(result.incidents.length, 1, 'overlapping events merge into one incident');
  assert.deepEqual([...result.incidents[0].layers].sort(), ['renderer-heartbeat', 'renderer-task']);
  assert.equal(result.incidents[0].peakCpuPct, 96, 'peak CPU pulled from metrics window');

  const md = readFileSync(result.mdPath, 'utf8');
  assert.ok(md.includes('click Freeze 4s'), 'md has triggering action');
  assert.ok(md.includes('FAIL'), 'md has verdict');

  const html = readFileSync(result.htmlPath, 'utf8');
  assert.ok(html.includes('class="bar freeze'), 'html has a freeze bar');
  assert.ok(html.includes('onClick'), 'html has LoAF script attribution');
}
