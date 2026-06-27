import { join } from 'node:path';
import { FreezeBus, type FreezeEvent } from './freezeBus.js';
import type { Config } from './config.js';
import type { Detector, DetectorCtx } from './detector.js';
import type { MainBridge } from './mainBridge.js';
import { JsonlWriter } from './util/jsonl.js';
import { RendererHeartbeat } from './detectors/rendererHeartbeat.js';
import { RendererTasks } from './detectors/rendererTasks.js';
import { JsErrors } from './detectors/jsErrors.js';
import { StallWatch } from './detectors/stallWatch.js';
import { StorageDisk } from './detectors/storageDisk.js';
import { MainLoopLag } from './detectors/mainLoopLag.js';
import { AppMetrics } from './detectors/appMetrics.js';
import { NativeSignals } from './detectors/nativeSignals.js';
import { IpcFlood } from './detectors/ipcFlood.js';
import { DeepEvidence } from './detectors/deepEvidence.js';
import { log } from './util/logger.js';
import type { Page } from 'playwright';

// Constructs + start/stops every detector (the monitoringBundle analog). Owns freezes.jsonl:
// every event any detector pushes onto the bus is appended here, which the reporter reads back.
export class Monitor {
  private readonly bus = new FreezeBus();
  private readonly detectors: Detector[] = [];
  private readonly freezes: JsonlWriter;
  private readonly mainBridge?: MainBridge;
  readonly events: FreezeEvent[] = [];

  constructor(opts: { page: Page; mainBridge?: MainBridge; config: Config; runDir: string }) {
    this.mainBridge = opts.mainBridge;
    this.freezes = new JsonlWriter(join(opts.runDir, 'freezes.jsonl'));
    this.bus.onFreeze((ev) => { this.events.push(ev); void this.freezes.append(ev); });

    const ctx: DetectorCtx = {
      page: opts.page, mainBridge: opts.mainBridge, bus: this.bus,
      config: opts.config, runDir: opts.runDir,
    };
    // Renderer + deep layers work over any channel; main-process layers need a MainBridge
    // (Playwright in source mode, or a Node inspector attach in cdp+inspect mode).
    this.detectors.push(new RendererHeartbeat(ctx), new RendererTasks(ctx), new JsErrors(ctx), new StallWatch(ctx), new StorageDisk(ctx), new DeepEvidence(ctx));
    if (opts.mainBridge) {
      this.detectors.push(new MainLoopLag(ctx), new AppMetrics(ctx), new NativeSignals(ctx), new IpcFlood(ctx));
    } else {
      log('warn', 'no main-process channel: layers main-loop, hardware, native are unavailable (plain cdp without --inspect)');
    }
  }

  async start(): Promise<void> {
    for (const d of this.detectors) {
      log('info', `starting detector: ${d.name}`);
      await d.start();
    }
    log('info', `monitor started: ${this.detectors.map((d) => d.name).join(', ')}`);
  }

  async stop(): Promise<void> {
    // Bound each detector's teardown: after a renderer crash, polls that do page.evaluate on the
    // dead renderer never resolve, so race every stop() against a timeout.
    for (const d of this.detectors) {
      await Promise.race([
        d.stop().catch((e) => log('warn', `stop ${d.name} failed`, e)),
        new Promise<void>((r) => setTimeout(() => { log('warn', `stop ${d.name} timed out`); r(); }, 7000)),
      ]);
    }
    await this.mainBridge?.close().catch(() => {});
    await this.freezes.close();
  }
}
