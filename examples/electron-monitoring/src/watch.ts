import { join } from 'node:path';
import { _electron as electron, chromium, type ElectronApplication, type Page } from 'playwright';
import { loadConfig } from './config.js';
import { Monitor } from './monitor.js';
import { JsonlWriter } from './util/jsonl.js';
import { startRun, writeMeta, readMeta } from './runContext.js';
import { buildReport } from './report.js';
import { ElectronAppBridge, InspectorBridge, type MainBridge } from './mainBridge.js';
import { MainInspector } from './mainInspector.js';
import { log } from './util/logger.js';

// WATCH MODE — interactive, no scripted scenario.
// Attaches to the app, keeps every detector running, and lets YOU drive: click around and reproduce
// the freeze by hand. Real clicks are captured in the renderer so freezes get attributed to "the
// button you clicked". Stop with Ctrl+C (or WATCH_MAX_SECONDS) and it writes the same report.
//
//   npm run watch                                    # launches ./demo-app (or ELECTRON_APP_PATH)
//   LAUNCH_MODE=cdp ELECTRON_CDP_ENDPOINT=… \
//     ELECTRON_INSPECT_ENDPOINT=… npm run watch      # attach to a running packaged app

// Runs IN the renderer: record every user click so a following freeze can be blamed on it.
function installClickCapture(): void {
  const w = window as unknown as { __clicksInstalled?: boolean; __clicks?: unknown[]; __drainClicks?: () => unknown[] };
  if (w.__clicksInstalled) return;
  w.__clicksInstalled = true;
  w.__clicks = [];
  document.addEventListener('click', (e) => {
    const t = e.target as Element | null;
    let label = '';
    try {
      label = t?.getAttribute?.('data-testid') || (t?.textContent || '').trim().slice(0, 40) || t?.tagName || '';
    } catch { /* detached node */ }
    w.__clicks!.push({ name: 'click ' + (label || 'element'), ts: Date.now() });
  }, true);
  w.__drainClicks = () => { const c = w.__clicks!; w.__clicks = []; return c; };
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const runDir = startRun();

  let electronApp: ElectronApplication | undefined;
  let page: Page;
  let mainBridge: MainBridge | undefined;

  if (cfg.launchMode === 'cdp') {
    if (!cfg.cdpEndpoint) throw new Error('LAUNCH_MODE=cdp requires ELECTRON_CDP_ENDPOINT');
    const browser = await chromium.connectOverCDP(cfg.cdpEndpoint);
    const ctx = browser.contexts()[0];
    page = ctx.pages()[0] ?? (await ctx.waitForEvent('page'));
    if (cfg.inspectEndpoint) {
      try {
        mainBridge = new InspectorBridge(await MainInspector.connect(cfg.inspectEndpoint));
      } catch (e) {
        log('warn', `inspector attach failed (${cfg.inspectEndpoint}) — main-process layers stay off`, e);
      }
    }
  } else {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    electronApp = await electron.launch({ args: [cfg.appPath], env: env as Record<string, string> });
    page = await electronApp.firstWindow();
    mainBridge = new ElectronAppBridge(electronApp);
  }

  // Under tsx, esbuild rewrites evaluated functions with a `__name` helper that doesn't exist in the
  // renderer. Define a no-op shim (as a string — strings aren't bundler-transformed) before any
  // function-based addInitScript/evaluate so the helper resolves. No-op under the Playwright runner.
  const NAME_SHIM = 'globalThis.__name = globalThis.__name || function (f) { return f; }';
  await page.addInitScript({ content: NAME_SHIM }).catch(() => {});
  await page.evaluate(NAME_SHIM).catch(() => {});

  await page.addInitScript(installClickCapture).catch(() => {});
  await page.evaluate(installClickCapture).catch(() => {});

  const monitor = new Monitor({ page, mainBridge, config: cfg, runDir });
  await monitor.start();

  const loafSupported = (await page
    .evaluate(() => (globalThis as unknown as { __loafSupported?: boolean }).__loafSupported ?? false)
    .catch(() => false)) as boolean;
  writeMeta(runDir, {
    appLabel: cfg.launchMode === 'cdp' ? cfg.cdpEndpoint! : cfg.appPath,
    launchMode: cfg.launchMode, mainLayers: !!mainBridge, loafSupported,
  });

  // Drain captured clicks into actions.jsonl. Each click becomes its own attribution window
  // [ts, ts+ACTION_WINDOW]; the correlator blames a freeze on the most-recent containing click.
  // Drains are serialized on a promise chain so a drain racing with shutdown can't drop the last one.
  const ACTION_WINDOW_MS = 12_000;
  const actions = new JsonlWriter(join(runDir, 'actions.jsonl'));
  let drainChain: Promise<void> = Promise.resolve();
  const drainOnce = async (): Promise<void> => {
    try {
      const clicks = (await page.evaluate(
        () => (globalThis as unknown as { __drainClicks?: () => { name: string; ts: number }[] }).__drainClicks?.() ?? [],
      )) as { name: string; ts: number }[];
      for (const c of clicks) {
        await actions.append({ name: c.name, startIso: new Date(c.ts).toISOString(), endIso: new Date(c.ts + ACTION_WINDOW_MS).toISOString() });
        log('info', `↳ ${c.name}`);
      }
    } catch { /* page busy/closed — retry next tick */ }
  };
  const drainClicks = (): Promise<void> => { drainChain = drainChain.then(drainOnce); return drainChain; };
  const drainTimer = setInterval(() => { void drainClicks(); }, 500);

  log('info', '────────────────────────────────────────────────────────');
  log('info', `WATCHING — use the app and reproduce the freeze. Ctrl+C to stop.`);
  log('info', `run dir: ${runDir}`);
  log('info', '────────────────────────────────────────────────────────');

  let stopping = false;
  const finish = async (reason: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    log('info', `stopping (${reason}) — writing report…`);
    clearInterval(drainTimer);
    await drainClicks(); // serialized — waits for any in-flight drain, then captures the last clicks
    await actions.close();
    await monitor.stop();
    if (electronApp) await electronApp.close().catch(() => {});
    writeMeta(runDir, { sessionEndIso: new Date().toISOString() });

    const m = readMeta(runDir);
    const r = buildReport(runDir, {
      sessionStartIso: m.sessionStartIso as string,
      sessionEndIso: m.sessionEndIso as string,
      appLabel: (m.appLabel as string) ?? cfg.appPath,
      launchMode: cfg.launchMode,
      thresholdMs: cfg.heartbeatMs,
      loafSupported: (m.loafSupported as boolean) ?? false,
      mainLayers: (m.mainLayers as boolean) ?? false,
    });
    console.log(`\nVerdict: ${r.verdict}`);
    console.log(`Report:  ${r.mdPath}`);
    console.log(`         ${r.htmlPath}\n`);
    process.exit(r.exitCode);
  };

  process.on('SIGINT', () => { console.log(); void finish('Ctrl+C'); });
  process.on('SIGTERM', () => { void finish('SIGTERM'); });
  const maxSec = Number(process.env.WATCH_MAX_SECONDS ?? 0);
  if (maxSec > 0) setTimeout(() => { void finish(`WATCH_MAX_SECONDS=${maxSec}`); }, maxSec * 1000);
}

main().catch((e) => { console.error(e); process.exit(1); });
