import { join } from 'node:path';
import { FreezeBus, type FreezeEvent } from './freezeBus.js';
import type { Config } from './config.js';
import type { Detector, DetectorCtx } from './detector.js';
import { JsonlWriter } from './util/jsonl.js';
import { RendererHeartbeat } from './detectors/rendererHeartbeat.js';
import { RendererTasks } from './detectors/rendererTasks.js';
import { MainLoopLag } from './detectors/mainLoopLag.js';
import { AppMetrics } from './detectors/appMetrics.js';
import { NativeSignals } from './detectors/nativeSignals.js';
import { DeepEvidence } from './detectors/deepEvidence.js';
import { log } from './util/logger.js';
import type { ElectronApplication, Page } from 'playwright';

// Constructs + start/stops every detector (the monitoringBundle analog). Owns freezes.jsonl:
// every event any detector pushes onto the bus is appended here, which the reporter reads back.
export class Monitor {
  private readonly bus = new FreezeBus();
  private readonly detectors: Detector[] = [];
  private readonly freezes: JsonlWriter;
  readonly events: FreezeEvent[] = [];

  constructor(opts: { page: Page; electronApp?: ElectronApplication; config: Config; runDir: string }) {
    this.freezes = new JsonlWriter(join(opts.runDir, 'freezes.jsonl'));
    this.bus.onFreeze((ev) => { this.events.push(ev); void this.freezes.append(ev); });

    const ctx: DetectorCtx = {
      page: opts.page, electronApp: opts.electronApp, bus: this.bus,
      config: opts.config, runDir: opts.runDir,
    };
    // Renderer + deep layers work in both modes; main-process layers need electronApp (source mode).
    this.detectors.push(new RendererHeartbeat(ctx), new RendererTasks(ctx), new DeepEvidence(ctx));
    if (opts.electronApp) {
      this.detectors.push(new MainLoopLag(ctx), new AppMetrics(ctx), new NativeSignals(ctx));
    } else {
      log('warn', 'cdp mode: main-process layers (main-loop, hardware, native) are unavailable');
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
    await this.freezes.close();
  }
}
