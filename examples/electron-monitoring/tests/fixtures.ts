import { test as base, expect } from '@playwright/test';
import {
  _electron as electron, chromium,
  type BrowserContext, type ElectronApplication, type Page,
} from 'playwright';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { Monitor } from '../src/monitor.js';
import { setAction, clearAction } from '../src/currentAction.js';
import { JsonlWriter } from '../src/util/jsonl.js';
import { getRunDir, writeMeta } from '../src/runContext.js';
import { ElectronAppBridge, InspectorBridge, type MainBridge } from '../src/mainBridge.js';
import { MainInspector } from '../src/mainInspector.js';
import { watchMainDeath } from '../src/mainDeath.js';
import { log } from '../src/util/logger.js';

type StepFn = <T>(name: string, fn: () => Promise<T>) => Promise<T>;
export interface Harness {
  window: Page;
  electronApp?: ElectronApplication;
  /** Tag a UI action so freezes during it are attributed to it in the report. */
  step: StepFn;
}

// Launches Electron (source) or attaches over CDP (packaged), wires the 6-layer Monitor +
// Playwright trace/video, exposes window + step(), and on teardown flushes all evidence into
// the shared run dir (the report is built once in global-teardown).
export const test = base.extend<{ app: Harness }>({
  app: async ({}, use) => {
    const cfg = loadConfig();
    const runDir = getRunDir();

    let electronApp: ElectronApplication | undefined;
    let context: BrowserContext;
    let window: Page;
    let mainBridge: MainBridge | undefined;
    let tearingDown = false;

    if (cfg.launchMode === 'cdp') {
      if (!cfg.cdpEndpoint) throw new Error('LAUNCH_MODE=cdp requires ELECTRON_CDP_ENDPOINT');
      const browser = await chromium.connectOverCDP(cfg.cdpEndpoint);
      context = browser.contexts()[0];
      window = context.pages()[0] ?? (await context.waitForEvent('page'));
      // Optional: attach to the main process over its Node inspector to unlock L3/L4/L5.
      if (cfg.inspectEndpoint) {
        try {
          mainBridge = new InspectorBridge(await MainInspector.connect(cfg.inspectEndpoint));
        } catch (e) {
          log('warn', `could not attach main-process inspector (${cfg.inspectEndpoint}) — L3/L4/L5 stay off`, e);
        }
      }
    } else {
      // Strip ELECTRON_RUN_AS_NODE — if the launcher inherits it (set by some Electron-based IDEs/CI
      // runners) the child runs as plain Node and rejects Chromium flags. No-op in a clean env.
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const launchOpts: { args: string[]; env: Record<string, string>; recordVideo?: { dir: string } } = {
        args: [cfg.appPath],
        env: env as Record<string, string>,
      };
      if (cfg.recordVideo) launchOpts.recordVideo = { dir: runDir };
      electronApp = await electron.launch(launchOpts);
      window = await electronApp.firstWindow();
      context = electronApp.context();
      mainBridge = new ElectronAppBridge(electronApp);
      watchMainDeath(electronApp, runDir, () => tearingDown);
    }

    // ponytail: Playwright's context.tracing.start() hangs on an Electron context — skipped.
    // Coverage comes from recordVideo (below) + CDP trace.json (L6 deepEvidence) + the JSONL streams.
    void context;

    const monitor = new Monitor({ page: window, mainBridge, config: cfg, runDir });
    await monitor.start();

    const loafSupported = (await window
      .evaluate(() => (globalThis as unknown as { __loafSupported?: boolean }).__loafSupported ?? false)
      .catch(() => false)) as boolean;
    writeMeta(runDir, {
      appLabel: cfg.launchMode === 'cdp' ? cfg.cdpEndpoint! : cfg.appPath,
      launchMode: cfg.launchMode,
      mainLayers: !!mainBridge,
      loafSupported,
    });

    const actionsLog = new JsonlWriter(join(runDir, 'actions.jsonl'));
    const step: StepFn = async (name, fn) => {
      setAction(name);
      try {
        return await fn();
      } finally {
        const w = clearAction();
        if (w) await actionsLog.append(w);
      }
    };

    await use({ window, electronApp, step });

    tearingDown = true;
    await monitor.stop();
    await actionsLog.close();
    const video = cfg.recordVideo ? window.video() : undefined;
    if (electronApp) await electronApp.close().catch(() => {});
    await video?.saveAs(join(runDir, 'video.webm')).catch(() => {});
  },
});

export { expect };
