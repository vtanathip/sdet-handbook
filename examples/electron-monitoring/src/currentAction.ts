// Module singleton holding the in-flight UI action so freezes can be attributed to the
// click/keystroke that triggered them. step() in tests/fixtures.ts sets it before running
// the action (the action itself may block) and clears it after.
export interface ActionWindow {
  name: string;
  startIso: string;
  endIso: string;
}

let current: { name: string; startIso: string } | undefined;

export function setAction(name: string): void {
  current = { name, startIso: new Date().toISOString() };
}

export function clearAction(): ActionWindow | undefined {
  if (!current) return undefined;
  const w: ActionWindow = { ...current, endIso: new Date().toISOString() };
  current = undefined;
  return w;
}

export function getAction(): { name: string; startIso: string } | undefined {
  return current;
}
