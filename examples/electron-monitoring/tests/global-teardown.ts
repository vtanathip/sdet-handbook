import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getRunDir, readMeta, writeMeta } from '../src/runContext.js';
import { buildReport } from '../src/report.js';
import { loadConfig } from '../src/config.js';

// Builds the report from the run's JSONL evidence after all specs finish, and records the verdict
// + exit code to result.json. `npm test` prints it; `npm run signoff` exits with that code.
// (Playwright ignores process.exitCode here, so exact codes are surfaced via src/signoff.ts.)
export default function globalTeardown(): void {
  const dir = getRunDir();
  const cfg = loadConfig();
  writeMeta(dir, { sessionEndIso: new Date().toISOString() });
  const m = readMeta(dir);

  const result = buildReport(dir, {
    sessionStartIso: (m.sessionStartIso as string) ?? new Date().toISOString(),
    sessionEndIso: (m.sessionEndIso as string) ?? new Date().toISOString(),
    appLabel: (m.appLabel as string) ?? cfg.appPath,
    launchMode: (m.launchMode as string) ?? cfg.launchMode,
    thresholdMs: cfg.heartbeatMs,
    loafSupported: (m.loafSupported as boolean) ?? false,
    mainLayers: (m.mainLayers as boolean) ?? false,
  });

  writeFileSync(join(dir, 'result.json'), JSON.stringify({ verdict: result.verdict, exitCode: result.exitCode }, null, 2));
  console.log(`\n[electron-monitoring] Verdict: ${result.verdict}`);
  console.log(`[electron-monitoring] Report:  ${result.mdPath}`);
  console.log(`[electron-monitoring]          ${result.htmlPath}\n`);
}
