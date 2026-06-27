import { join } from 'node:path';
import type { Detector, DetectorCtx } from '../detector.js';
import { JsonlWriter } from '../util/jsonl.js';

// App-domain context — the one thing a freeze probe can't infer. Only the app knows it was
// "validating cart #42" right before it hung. We capture the app's OWN console output (every level,
// not just errors — that's jsErrors' job) as a timestamped breadcrumb trail, so the report can show
// "what the app logged just before it froze" next to each incident. We don't interpret it.
//
// Breadcrumbs are context, not incidents: they never touch the freeze bus and never gate the verdict.
// Works over any channel (page only); console output flows the same in source and cdp modes.
export class Breadcrumbs implements Detector {
  readonly name = 'breadcrumb';
  private out: JsonlWriter;
  constructor(private readonly ctx: DetectorCtx) {
    this.out = new JsonlWriter(join(ctx.runDir, 'breadcrumbs.jsonl'));
  }

  async start(): Promise<void> {
    this.ctx.page.on('console', (msg) => {
      void this.out.append({
        ts: new Date().toISOString(),
        where: 'renderer',
        level: msg.type(),
        text: msg.text().slice(0, 500), // ponytail: cap line length; full text is in trace/devtools
      });
    });
  }

  async stop(): Promise<void> {
    await this.out.close();
  }
}
