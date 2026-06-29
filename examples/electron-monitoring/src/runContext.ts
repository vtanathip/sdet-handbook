import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { uptime, loadavg, freemem, totalmem } from 'node:os';

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
  writeMeta(dir, {
    sessionStartIso: new Date().toISOString(),
    // Host context: a long-up / loaded / low-mem box can explain a slow or flaky run a fresh boot
    // wouldn't. Evidence only — never gated on (uptime alone doesn't predict freezes).
    hostUptimeSec: Math.round(uptime()),
    loadAvg: loadavg().map((n) => Math.round(n * 100) / 100),
    freeMemMB: Math.round(freemem() / 2 ** 20),
    totalMemMB: Math.round(totalmem() / 2 ** 20),
  });
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
