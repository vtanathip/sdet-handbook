import type { FreezeEvent } from './freezeBus.js';
import type { ActionWindow } from './currentAction.js';

// Joins each freeze to the UI action in flight when it started. Pure + runs at report time:
// the step() wrapper records [start,end] windows to actions.jsonl, and we interval-join here.
// A small tolerance absorbs clock rounding between the detector and the step wrapper.
export function correlate(
  freezes: FreezeEvent[],
  actions: ActionWindow[],
  toleranceMs = 300,
): FreezeEvent[] {
  return freezes.map((f) => {
    const t = Date.parse(f.startIso);
    // Among actions whose window contains the freeze, pick the most-recent one (latest start).
    // For scripted step() windows (non-overlapping) this is the only match; for watch-mode click
    // windows (which can overlap) it blames the closest preceding click.
    const hit = actions
      .filter((a) => t >= Date.parse(a.startIso) - toleranceMs && t <= Date.parse(a.endIso) + toleranceMs)
      .sort((a, b) => Date.parse(b.startIso) - Date.parse(a.startIso))[0];
    return { ...f, action: hit ? hit.name : '(idle / between steps)' };
  });
}
