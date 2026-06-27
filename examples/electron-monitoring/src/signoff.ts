import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getRunDir } from './runContext.js';

// Runs the Playwright sweep, then exits with the freeze-verdict code (0 PASS / 1 CAUTION / 2 FAIL)
// so CI gates on whether the APP froze — Playwright's own exit code only reflects test errors.
const res = spawnSync('npx', ['playwright', 'test'], { stdio: 'inherit', shell: true });
let exitCode = res.status ?? 0;
try {
  const result = JSON.parse(
    readFileSync(join(getRunDir(), 'result.json'), 'utf8'),
  ) as { verdict: string; exitCode: number };
  console.log(`\nSign-off verdict: ${result.verdict} (exit ${result.exitCode})`);
  exitCode = result.exitCode;
} catch (e) {
  console.error('could not read sign-off result.json:', (e as Error).message);
}
process.exit(exitCode);
