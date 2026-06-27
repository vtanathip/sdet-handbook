import assert from 'node:assert/strict';
import { correlate } from '../../src/correlator.js';
import type { FreezeEvent } from '../../src/freezeBus.js';

// Each freeze inside an action window is attributed to it; one outside falls back to "(idle)".
export function run(): void {
  const base = Date.parse('2026-06-27T10:00:00.000Z');
  const iso = (o: number) => new Date(base + o).toISOString();
  const actions = [
    { name: 'A', startIso: iso(0), endIso: iso(1000) },
    { name: 'B', startIso: iso(2000), endIso: iso(3000) },
    { name: 'C', startIso: iso(4000), endIso: iso(5000) },
  ];
  const freezes: FreezeEvent[] = [
    { layer: 'renderer-heartbeat', startIso: iso(500), durationMs: 400, severity: 'MINOR', detail: {} },
    { layer: 'main-loop', startIso: iso(2500), durationMs: 400, severity: 'MINOR', detail: {} },
    { layer: 'renderer-task', startIso: iso(4500), durationMs: 400, severity: 'MINOR', detail: {} },
    { layer: 'hardware', startIso: iso(8000), durationMs: 0, severity: 'MINOR', detail: {} },
  ];
  const out = correlate(freezes, actions);
  assert.equal(out[0].action, 'A');
  assert.equal(out[1].action, 'B');
  assert.equal(out[2].action, 'C');
  assert.equal(out[3].action, '(idle / between steps)');
}
