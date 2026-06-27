import assert from 'node:assert/strict';
import { findGaps } from '../../src/detectors/rendererHeartbeat.js';

// L1 gap detection: a tick series with a 500ms hole yields exactly one freeze; a smooth series none.
export function run(): void {
  const ticks = [0, 50, 100, 150, 650, 700, 750]; // 500ms hole between 150 and 650
  const gaps = findGaps(ticks, 200);
  assert.equal(gaps.length, 1, 'exactly one gap > 200ms');
  assert.ok(gaps[0].gapMs >= 490 && gaps[0].gapMs <= 510, `gap ~500ms, got ${gaps[0].gapMs}`);
  assert.equal(findGaps([0, 50, 100, 150], 200).length, 0, 'smooth series → no freeze');
}
