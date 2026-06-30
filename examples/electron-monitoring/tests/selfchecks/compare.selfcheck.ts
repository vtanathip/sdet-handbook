import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffStepSets, readRunSteps, diffRuns, comparePerf, reducePerf, type StepMetrics } from '../../src/compare.js';

// Build-vs-build diff: same scenario, the NEW build slows one step and freezes another →
// the diff flags exactly those two and the verdict regresses. Also exercises readRunSteps over
// on-disk evidence streams (windowing actions.jsonl + heartbeat/main-loop/ipc/freezes by time).
function step(name: string, over: Partial<StepMetrics> = {}): StepMetrics {
  return {
    name, startIso: '', endIso: '', durationMs: 1000, worstUiGapMs: 0, worstMainLagMs: 0,
    ipcMsgs: 0, ipcReplyP95Ms: 0, topIpcChannels: [], froze: false, worstFreezeMs: 0,
    freezeLayers: [], jsErrors: 0, netRequests: 0, slowestNetMs: 0, ...over,
  };
}

export function run(): void {
  // ── 1. pure diff core ──────────────────────────────────────────────────────────────────────────
  const oldSteps = [step('login', { durationMs: 1000 }), step('open orders', { durationMs: 800 }), step('filter', { durationMs: 500 })];
  const newSteps = [
    step('login', { durationMs: 1050 }),                                            // within tolerance — OK
    step('open orders', { durationMs: 2400, worstMainLagMs: 1800 }),                // 3× slower — regression
    step('filter', { durationMs: 600, froze: true, worstFreezeMs: 4200, freezeLayers: ['renderer-heartbeat'] }), // new SEVERE freeze
  ];
  const d = diffStepSets(oldSteps, newSteps, { tolerance: 1.2, absMinMs: 50, oldBuild: { label: 'old' }, newBuild: { label: 'new' } });

  const login = d.steps.find((s) => s.name === 'login')!;
  const orders = d.steps.find((s) => s.name === 'open orders')!;
  const filter = d.steps.find((s) => s.name === 'filter')!;
  assert.equal(login.timingRegressed, false, 'login within tolerance is not a regression');
  assert.equal(orders.timingRegressed, true, '3× slower step is flagged');
  assert.ok(orders.notes.some((n) => /main-loop lag/.test(n)), 'explains the slowdown with main-loop lag');
  assert.equal(filter.newFreeze, true, 'a brand-new freeze is flagged');
  assert.equal(filter.severe, true, 'a 4.2s new freeze is severe');
  assert.equal(d.verdict, 'FAIL', 'a new severe freeze fails the build');
  assert.equal(d.exitCode, 2);

  // No regressions → PASS.
  const clean = diffStepSets(oldSteps, oldSteps, { tolerance: 1.2, absMinMs: 50, oldBuild: { label: 'a' }, newBuild: { label: 'b' } });
  assert.equal(clean.verdict, 'PASS');
  assert.equal(clean.exitCode, 0);

  // ── 2. readRunSteps over on-disk streams ─────────────────────────────────────────────────────────
  const dir = mkdtempSync(join(tmpdir(), 'em-compare-'));
  const base = Date.parse('2026-06-29T10:00:00.000Z');
  const iso = (o: number) => new Date(base + o).toISOString();
  writeFileSync(join(dir, 'actions.jsonl'), JSON.stringify({ name: 'open orders', startIso: iso(0), endIso: iso(2000) }) + '\n');
  writeFileSync(join(dir, 'heartbeat.jsonl'), JSON.stringify({ ts: iso(500), gapMs: 320 }) + '\n' + JSON.stringify({ ts: iso(900), gapMs: 80 }) + '\n');
  writeFileSync(join(dir, 'main-loop.jsonl'), JSON.stringify({ ts: iso(600), kind: 'lag', maxLagMs: 1800 }) + '\n');
  writeFileSync(join(dir, 'ipc.jsonl'),
    JSON.stringify({ t: base + 700, transport: 'invoke', channel: 'orders:list', dir: 'r2m', bytes: 10, argTypes: [], preview: '' }) + '\n' +
    JSON.stringify({ t: base + 760, transport: 'invoke-reply', channel: 'orders:list', dir: 'm2r', bytes: 50, argTypes: [], preview: '', latencyMs: 60 }) + '\n');
  writeFileSync(join(dir, 'freezes.jsonl'), JSON.stringify({ layer: 'renderer-heartbeat', startIso: iso(500), durationMs: 320, action: 'open orders' }) + '\n');

  const steps = readRunSteps(dir);
  assert.equal(steps.length, 1);
  const s = steps[0];
  assert.equal(s.name, 'open orders');
  assert.equal(s.durationMs, 2000);
  assert.equal(s.worstUiGapMs, 320, 'worst UI gap windowed from heartbeat.jsonl');
  assert.equal(s.worstMainLagMs, 1800, 'worst main lag windowed from main-loop.jsonl');
  assert.equal(s.ipcMsgs, 1, 'one renderer→main invoke (reply not counted)');
  assert.equal(s.ipcReplyP95Ms, 60, 'invoke round-trip latency captured');
  assert.equal(s.froze, true);

  // End-to-end diffRuns over the same dir vs itself → no regression.
  const same = diffRuns(dir, dir);
  assert.equal(same.verdict, 'PASS');

  // ── 3. perf sign-off: budget scorecard over route × step, from real streams ──────────────────────
  const mk = (sub: string, mainLagMs: number, heapMB: number): string => {
    const d = mkdtempSync(join(tmpdir(), `em-perf-${sub}-`));
    const b = Date.parse('2026-06-29T12:00:00.000Z');
    const at = (o: number) => new Date(b + o).toISOString();
    writeFileSync(join(d, 'actions.jsonl'), JSON.stringify({ name: 'open orders', startIso: at(0), endIso: at(1000) }) + '\n');
    writeFileSync(join(d, 'routes.jsonl'), JSON.stringify({ ts: at(0), url: 'file:///app/index.html#/orders' }) + '\n');
    // a lag sample inside the step window so mainLagP95 is computed for both step and route('#/orders')
    writeFileSync(join(d, 'main-loop.jsonl'), JSON.stringify({ ts: at(500), kind: 'lag', maxLagMs: mainLagMs }) + '\n');
    writeFileSync(join(d, 'heap.jsonl'), JSON.stringify({ ts: at(500), heapMB, route: '/app/index.html#/orders' }) + '\n');
    return d;
  };
  const oldDir = mk('old', 200, 100);
  const newDir = mk('new', 1800, 105);          // main-lag 9× worse (regression); heap +5% (within budget)

  const perf = comparePerf(oldDir, newDir);
  const lagRow = perf.rows.find((r) => r.metricKey === 'mainLagP95' && r.dim === 'step');
  assert.ok(lagRow, 'main-lag is scored per step');
  assert.equal(lagRow!.gate, 'fail', '9× worse main-lag trips the gate (fail)');
  assert.ok(perf.rows.some((r) => r.metricKey === 'mainLagP95' && r.dim === 'route'), 'main-lag also scored per route');
  assert.equal(perf.verdict, 'FAIL', 'a severe metric regression fails the sign-off');

  // the route was attributed from the SPA hash, build-path independent
  const red = reducePerf(newDir);
  assert.ok(red.routes.some((c) => c.key === '#/orders'), 'events attributed to the SPA hash route');

  // same build vs itself → PASS
  assert.equal(comparePerf(oldDir, oldDir).verdict, 'PASS', 'identical builds pass the gate');
}
