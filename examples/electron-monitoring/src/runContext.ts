import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// One run directory per `playwright test` invocation, shared by every spec + the teardown via a
// pointer file (more robust than relying on env propagation into worker processes).
const ROOT = 'runs';
const POINTER = join(ROOT, '.current-run');

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function startRun(): string {
  const dir = join(ROOT, stamp());
  mkdirSync(dir, { recursive: true });
  writeFileSync(POINTER, dir);
  writeMeta(dir, { sessionStartIso: new Date().toISOString() });
  return dir;
}

export function getRunDir(): string {
  return readFileSync(POINTER, 'utf8').trim();
}

export function readMeta(dir: string): Record<string, unknown> {
  const p = join(dir, 'meta.json');
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>) : {};
}

export function writeMeta(dir: string, patch: Record<string, unknown>): void {
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ ...readMeta(dir), ...patch }, null, 2));
}
