import { readdirSync, statSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { log } from './util/logger.js';

// ---------------------------------------------------------------------------
// Schema & types
// ---------------------------------------------------------------------------

const SessionSchema = z.object({
  name: z.string(),
  socketPath: z.string(),
  timestamp: z.number(),
  version: z.string().optional(),
  cli: z.object({ persistent: z.boolean().optional() }).optional(),
  browser: z.object({
    browserName: z.string(),
    launchOptions: z.object({
      args: z.array(z.string()),
      channel: z.string().optional(),
      headless: z.boolean().optional(),
    }),
    userDataDir: z.string().optional(),
  }),
});

export type DaemonSession = z.infer<typeof SessionSchema>;

// ---------------------------------------------------------------------------
// Parsing helpers (kept exported for the self-test path in runCoordinator)
// ---------------------------------------------------------------------------

export function parseDaemonSession(raw: string): DaemonSession {
  const obj = JSON.parse(raw);
  return SessionSchema.parse(obj);
}

export function findCdpPort(s: DaemonSession): number {
  const arg = s.browser.launchOptions.args.find((a) =>
    a.startsWith('--remote-debugging-port='),
  );
  if (!arg) throw new Error('no --remote-debugging-port in launch args');
  const port = Number(arg.split('=')[1]);
  if (!Number.isFinite(port) || port <= 0) throw new Error(`invalid CDP port: ${arg}`);
  return port;
}

export async function fetchCdpWsUrl(port: number): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/json/version`);
  if (!res.ok) throw new Error(`CDP /json/version HTTP ${res.status}`);
  const json = (await res.json()) as { webSocketDebuggerUrl?: string };
  if (!json.webSocketDebuggerUrl) throw new Error('no webSocketDebuggerUrl');
  return json.webSocketDebuggerUrl;
}

// ---------------------------------------------------------------------------
// Filesystem scan
// ---------------------------------------------------------------------------

function listSessionFiles(daemonRoot: string): string[] {
  try {
    const out: { path: string; mtime: number }[] = [];
    for (const hex of readdirSync(daemonRoot)) {
      const hexDir = join(daemonRoot, hex);
      if (!statSync(hexDir).isDirectory()) continue;
      for (const f of readdirSync(hexDir)) {
        if (!f.endsWith('.session')) continue;
        const p = join(hexDir, f);
        out.push({ path: p, mtime: statSync(p).mtimeMs });
      }
    }
    return out.sort((a, b) => b.mtime - a.mtime).map((x) => x.path);
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// High-level discovery interface
// ---------------------------------------------------------------------------

/**
 * Verifies that the daemon root contains a parseable session file.
 * Call once at startup before the browser is opened to detect mis-configuration early.
 */
export function selfTestDaemon(daemonRoot: string): void {
  const files = listSessionFiles(daemonRoot);
  if (files.length === 0) {
    log('info', 'no pre-existing daemon sessions; self-test skipped');
    return;
  }
  const latest = files[0];
  const raw = readFileSync(latest, 'utf8');
  const parsed = parseDaemonSession(raw);
  findCdpPort(parsed);
  log('info', `daemon self-test ok (${latest})`);
}

/**
 * Polls the daemon root until a usable CDP WebSocket URL can be obtained,
 * then returns it. Retries for up to 30 s after the browser has been opened.
 */
export async function discoverCdpWs(daemonRoot: string): Promise<string> {
  const warned = new Set<string>();
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    const files = listSessionFiles(daemonRoot);
    if (files.length > 0) {
      try {
        const raw = await readFile(files[0], 'utf8');
        const s = parseDaemonSession(raw);
        const port = findCdpPort(s);
        return await fetchCdpWsUrl(port);
      } catch (err) {
        const msg = (err as Error).message;
        const key = `${files[0]}|${msg}`;
        if (!warned.has(key)) {
          warned.add(key);
          log('warn', `latest session file not usable yet (${files[0]}): ${msg}`);
        }
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `could not find usable daemon .session file within ${maxAttempts / 2}s of browser open`,
  );
}
