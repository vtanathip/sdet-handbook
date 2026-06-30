import { spawn, spawnSync } from 'node:child_process';

// Attach to a PACKAGED Electron build and run the scenario against it (the primary monitoring flow).
// A packaged app is only observable if it's launched with the two debug flags below — this wrapper
// launches the binary with them, waits for both endpoints to come up, points the harness at them, and
// runs `playwright test`. On teardown it kills the build. If an endpoint never appears it fails loudly
// with guidance (hardened/production builds that disable the Node inspector can't be attached).
//
//   npm run attach -- /path/to/YourApp.app/Contents/MacOS/YourApp [extra app args]
//   CDP_PORT=9222 INSPECT_PORT=9229 npm run attach -- ./dist/YourApp

const bin = process.argv[2];
const extraArgs = process.argv.slice(3);
if (!bin) {
  console.error('usage: npm run attach -- <path-to-packaged-binary> [app args]');
  process.exit(2);
}

const CDP_PORT = Number(process.env.CDP_PORT) || 9222;
const INSPECT_PORT = Number(process.env.INSPECT_PORT) || 9229;
const READY_TIMEOUT_MS = Number(process.env.ATTACH_TIMEOUT_MS) || 20_000;

async function waitFor(url: string, label: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // ponytail: fixed 250ms poll — fine for a one-shot launch; no backoff needed.
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) {
      throw new Error(
        `${label} endpoint never came up at ${url} after ${Math.round(timeoutMs / 1000)}s.\n` +
        `  • The build must be launched with the debug flags this wrapper passes — confirm your\n` +
        `    packaged app forwards argv to Electron and does not strip them.\n` +
        `  • Hardened/production builds that disable the Node inspector cannot be attached (the\n` +
        `    --inspect endpoint will never appear); use a debug/staging build, or source mode.`,
      );
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function main(): Promise<void> {
  let shuttingDown = false;
  const child = spawn(bin, [`--remote-debugging-port=${CDP_PORT}`, `--inspect=${INSPECT_PORT}`, ...extraArgs], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' }, // ensure it runs as an app, not plain node
  });
  child.on('exit', (code) => { if (code && !shuttingDown) console.error(`[attach] build exited early (code ${code})`); });

  const kill = (): void => { shuttingDown = true; try { child.kill('SIGTERM'); } catch { /* already gone */ } };
  process.on('SIGINT', () => { kill(); process.exit(1); });

  try {
    // Renderer over CDP + main process over the Node inspector (unlocks L3/L4/L5/L7).
    await Promise.all([
      waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`, 'CDP (renderer)', READY_TIMEOUT_MS),
      waitFor(`http://127.0.0.1:${INSPECT_PORT}/json`, 'Node inspector (main)', READY_TIMEOUT_MS),
    ]);
  } catch (e) {
    console.error(`[attach] ${(e as Error).message}`);
    kill();
    process.exit(2);
  }

  console.log(`[attach] build up — CDP :${CDP_PORT}, inspector :${INSPECT_PORT}. Running scenario…`);
  const res = spawnSync('npx', ['playwright', 'test'], {
    stdio: 'inherit', shell: true,
    env: {
      ...process.env,
      LAUNCH_MODE: 'cdp',
      ELECTRON_CDP_ENDPOINT: `http://127.0.0.1:${CDP_PORT}`,
      ELECTRON_INSPECT_ENDPOINT: `http://127.0.0.1:${INSPECT_PORT}`,
    },
  });
  kill();
  process.exit(res.status ?? 0);
}

void main();
