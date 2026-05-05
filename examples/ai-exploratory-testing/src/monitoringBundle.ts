import { CdpSampler } from './cdpSampler.js';
import { StuckDetector } from './stuckDetector.js';
import { SessionRunner } from './sessionRunner.js';
import { JsonlWriter } from './util/jsonl.js';
import { log } from './util/logger.js';

export interface MonitoringBundleOpts {
  cdpWsUrl: string;
  metrics: JsonlWriter;
  intervalSec: number;
  stuckDetectorSec: number;
  runner: SessionRunner;
}

/**
 * Owns the lifecycle of the CdpSampler, StuckDetector, and ping subscription
 * as a single unit. Callers interact through start() / stop() only.
 */
export class MonitoringBundle {
  private readonly sampler: CdpSampler;
  private readonly stuck: StuckDetector;
  private unsubPing?: () => void;

  constructor(private readonly opts: MonitoringBundleOpts) {
    this.sampler = new CdpSampler({
      cdpWsUrl: opts.cdpWsUrl,
      out: opts.metrics,
      intervalSec: opts.intervalSec,
    });
    this.stuck = new StuckDetector({
      thresholdSec: opts.stuckDetectorSec,
      onStuck: () => {
        log('warn', 'stuck detector fired; aborting current turn');
        void opts.runner.abort();
      },
    });
  }

  async start(): Promise<void> {
    await this.sampler.start();
    this.stuck.start();
    this.unsubPing = this.opts.runner.on(() => this.stuck.ping());
  }

  async stop(): Promise<void> {
    this.stuck.stop();
    this.unsubPing?.();
    await this.sampler.stop();
  }
}
