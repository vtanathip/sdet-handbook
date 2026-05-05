import { chromium, type Browser, type BrowserContext } from 'playwright';
import { JsonlWriter } from './util/jsonl.js';
import { log } from './util/logger.js';

export interface SamplerOpts {
  cdpWsUrl: string;
  out: JsonlWriter;
  intervalSec: number;
}

export class CdpSampler {
  private browser?: Browser;
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private warnedMultiPage = false;

  constructor(private readonly opts: SamplerOpts) {}

  async start(): Promise<void> {
    this.browser = await chromium.connectOverCDP(this.opts.cdpWsUrl);
    this.timer = setInterval(() => { void this.sampleOnce(); }, this.opts.intervalSec * 1000);
  }

  private async sampleOnce(): Promise<void> {
    if (!this.browser || this.stopped) return;
    try {
      const contexts = this.browser.contexts();
      const ctx: BrowserContext | undefined = contexts[0];
      if (!ctx) return;
      const pages = ctx.pages();
      if (pages.length > 1 && !this.warnedMultiPage) {
        this.warnedMultiPage = true;
        log('warn', `multiple pages detected (${pages.length}); sampling latest only`);
      }
      const page = pages[pages.length - 1];
      if (!page) return;
      const cdp = await ctx.newCDPSession(page);
      try {
        await cdp.send('Performance.enable');
        const { metrics } = await cdp.send('Performance.getMetrics');
        const mem = await cdp.send('Memory.getDOMCounters').catch(() => ({}));
        const record: Record<string, unknown> = {
          ts: new Date().toISOString(),
          url: page.url(),
          ...mem,
        };
        for (const m of metrics) {
          if (/JSHeap|Nodes|Listeners|Documents|LayoutCount/.test(m.name))
            record[m.name] = m.value;
        }
        await this.opts.out.append(record);
      } finally {
        await cdp.detach().catch(() => {});
      }
    } catch (err) {
      log('warn', 'sampler sampleOnce failed', err);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.browser) await this.browser.close().catch(() => {});
  }
}
