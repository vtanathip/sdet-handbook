import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { loadConfig } from '../src/config.js';
import { FreezeBus } from '../src/freezeBus.js';
import type { Detector, DetectorCtx } from '../src/detector.js';
import { ElectronAppBridge } from '../src/mainBridge.js';
import { RendererHeartbeat } from '../src/detectors/rendererHeartbeat.js';
import { RendererTasks } from '../src/detectors/rendererTasks.js';
import { JsErrors } from '../src/detectors/jsErrors.js';
import { Breadcrumbs } from '../src/detectors/breadcrumbs.js';
import { StallWatch } from '../src/detectors/stallWatch.js';
import { StorageDisk } from '../src/detectors/storageDisk.js';
import { MainLoopLag } from '../src/detectors/mainLoopLag.js';
import { AppMetrics } from '../src/detectors/appMetrics.js';
import { NativeSignals } from '../src/detectors/nativeSignals.js';
import { IpcFlood } from '../src/detectors/ipcFlood.js';
import { Subprocess } from '../src/detectors/subprocess.js';
import { DeepEvidence } from '../src/detectors/deepEvidence.js';

// Observer-effect benchmark: does the monitoring make the app measurably worse?
// Launches the demo three ways and runs the SAME fixed workload each time:
//   off        — no detectors (baseline)
//   on-noTrace — every detector except L6 deep-evidence (CDP trace + v8 cpu_profiler)
//   on-full    — every detector (what a real run uses)
// Two workloads, both measured inside the renderer so the numbers are the app's own experience:
//   render — 80 × 5ms busy chunks that YIELD between chunks (so 250ms polls can interleave): wall ms
//   ipc    — 300 × ipcRenderer.invoke('main-busy', 0) round-trips: avg ms/round-trip
// Overhead = (mode − off) / off. This is a CI/test-box measurement; absolute numbers vary by machine.

const NAME_SHIM = 'globalThis.__name = globalThis.__name || function (f) { return f; }';
const RENDER_WORKLOAD =
  `(async () => { const t0 = performance.now();` +
  ` for (let r = 0; r < 80; r++) { const s = performance.now(); while (performance.now() - s < 5) {} await new Promise(res => setTimeout(res, 0)); }` +
  ` return performance.now() - t0; })()`;
const IPC_WORKLOAD =
  `(async () => { const N = 300; const t0 = performance.now();` +
  ` for (let i = 0; i < N; i++) { await window.freeze.mainBusy(0); }` +
  ` return (performance.now() - t0) / N; })()`;

const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

function makeDetectors(ctx: DetectorCtx, withTrace: boolean): Detector[] {
  const ds: Detector[] = [new RendererHeartbeat(ctx), new RendererTasks(ctx), new JsErrors(ctx), new Breadcrumbs(ctx), new StallWatch(ctx), new StorageDisk(ctx)];
  if (withTrace) ds.push(new DeepEvidence(ctx));
  ds.push(new MainLoopLag(ctx), new AppMetrics(ctx), new NativeSignals(ctx), new IpcFlood(ctx), new Subprocess(ctx));
  return ds;
}

async function measure(page: Page, runs: number): Promise<{ render: number; ipc: number }> {
  await page.evaluate(RENDER_WORKLOAD); // warm up (discard)
  await page.evaluate(IPC_WORKLOAD);
  const render: number[] = [];
  for (let i = 0; i < runs; i++) render.push((await page.evaluate(RENDER_WORKLOAD)) as number);
  const ipc: number[] = [];
  for (let i = 0; i < 5; i++) ipc.push((await page.evaluate(IPC_WORKLOAD)) as number);
  return { render: median(render), ipc: median(ipc) };
}

async function runMode(appPath: string, mode: 'off' | 'on-noTrace' | 'on-full'): Promise<{ render: number; ipc: number }> {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app: ElectronApplication = await electron.launch({ args: [appPath], env: env as Record<string, string> });
  const page = await app.firstWindow();
  await page.addInitScript({ content: NAME_SHIM }).catch(() => {});
  await page.evaluate(NAME_SHIM).catch(() => {});

  let detectors: Detector[] = [];
  if (mode !== 'off') {
    const runDir = mkdtempSync(join(tmpdir(), 'em-bench-'));
    const ctx: DetectorCtx = { page, mainBridge: new ElectronAppBridge(app), bus: new FreezeBus(), config: loadConfig(), runDir };
    detectors = makeDetectors(ctx, mode === 'on-full');
    for (const d of detectors) await d.start();
    await new Promise((r) => setTimeout(r, 1200)); // let pollers settle into steady state
  }

  const result = await measure(page, 7);
  for (const d of detectors) await d.stop().catch(() => {});
  await app.close().catch(() => {});
  return result;
}

async function main(): Promise<void> {
  const appPath = loadConfig().appPath;
  const pct = (v: number, base: number): string => `${v >= base ? '+' : ''}${(((v - base) / base) * 100).toFixed(1)}%`;

  const off = await runMode(appPath, 'off');
  const noTrace = await runMode(appPath, 'on-noTrace');
  const full = await runMode(appPath, 'on-full');

  const row = (name: string, m: { render: number; ipc: number }) =>
    `${name.padEnd(12)} render ${m.render.toFixed(1).padStart(7)}ms (${pct(m.render, off.render).padStart(7)})   ipc/rt ${m.ipc.toFixed(3).padStart(6)}ms (${pct(m.ipc, off.ipc).padStart(7)})`;

  console.log('\n── Observer-effect benchmark (overhead vs monitoring OFF) ───────────────────');
  console.log(row('off', off));
  console.log(row('on-noTrace', noTrace));
  console.log(row('on-full', full));
  console.log('─────────────────────────────────────────────────────────────────────────────');
  console.log(`L6 trace share of render overhead: ${(full.render - noTrace.render).toFixed(1)}ms`);
  console.log('Note: CI/test-box measurement; absolute ms vary by machine. Run a few times.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
