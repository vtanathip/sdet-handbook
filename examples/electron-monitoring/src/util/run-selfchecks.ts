import { run as heartbeat } from '../../tests/selfchecks/heartbeat.selfcheck.js';
import { run as eventloop } from '../../tests/selfchecks/eventloop.selfcheck.js';
import { run as correlator } from '../../tests/selfchecks/correlator.selfcheck.js';
import { run as report } from '../../tests/selfchecks/report.selfcheck.js';

// Runs the four pure self-checks (no Electron, no browser). `npm run selfcheck`.
const checks: [string, () => void | Promise<void>][] = [
  ['heartbeat', heartbeat],
  ['eventloop', eventloop],
  ['correlator', correlator],
  ['report', report],
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
