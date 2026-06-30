import { run as heartbeat } from '../../tests/selfchecks/heartbeat.selfcheck.js';
import { run as eventloop } from '../../tests/selfchecks/eventloop.selfcheck.js';
import { run as correlator } from '../../tests/selfchecks/correlator.selfcheck.js';
import { run as report } from '../../tests/selfchecks/report.selfcheck.js';
import { run as sourcemap } from '../../tests/selfchecks/sourcemap.selfcheck.js';
import { run as compare } from '../../tests/selfchecks/compare.selfcheck.js';
import { run as ipcRendererTap } from '../../tests/selfchecks/ipcRendererTap.selfcheck.js';
import { run as storageTap } from '../../tests/selfchecks/storageTap.selfcheck.js';

// Runs the pure self-checks (no Electron, no browser). `npm run selfcheck`.
const checks: [string, () => void | Promise<void>][] = [
  ['heartbeat', heartbeat],
  ['eventloop', eventloop],
  ['correlator', correlator],
  ['report', report],
  ['sourcemap', sourcemap],
  ['compare', compare],
  ['ipc-renderer-tap', ipcRendererTap],
  ['storage-tap', storageTap],
];

let failed = 0;
for (const [name, fn] of checks) {
  try {
    await fn();
    console.log(`✅ ${name}`);
  } catch (e) {
    failed++;
    console.error(`❌ ${name}:`, (e as Error).message);
  }
}
if (failed) {
  console.error(`\n${failed} self-check(s) failed`);
  process.exit(1);
}
console.log('\nAll self-checks passed');
