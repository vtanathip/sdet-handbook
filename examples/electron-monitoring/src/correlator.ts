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
    const hit = actions.find((a) => {
      const s = Date.parse(a.startIso) - toleranceMs;
      const e = Date.parse(a.endIso) + toleranceMs;
      return t >= s && t <= e;
    });
    return { ...f, action: hit ? hit.name : '(idle / between steps)' };
  });
}
