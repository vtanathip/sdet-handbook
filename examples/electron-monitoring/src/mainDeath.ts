import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronApplication } from 'playwright';
import { log } from './util/logger.js';

// Detect death of the MAIN (Browser) process from the harness side. The in-app L5 listeners
// (render/child-process-gone) live IN main, so when main itself dies — uncaught main exception,
// process.exit/app.exit, main OOM, native-addon abort, SIGKILL of the Browser process — nothing in
// the app can report it. Watching electronApp.process()'s 'exit' is the only way to label it.
// Source mode only (Playwright owns the process handle).
export function watchMainDeath(app: ElectronApplication, runDir: string, isTearingDown: () => boolean): void {
  app.process().on('exit', (code, signal) => {
    if (isTearingDown()) return; // a clean Monitor.stop()/app.close() — not a crash
    const ev = {
      layer: 'native', startIso: new Date().toISOString(), durationMs: 0, severity: 'SEVERE',
      detail: { kind: 'main-process-gone', code, signal },
    };
    try { appendFileSync(join(runDir, 'freezes.jsonl'), JSON.stringify(ev) + '\n'); } catch { /* dir gone */ }
    log('error', `[MAIN] main process exited unexpectedly (code=${code} signal=${signal})`);
  });
}
