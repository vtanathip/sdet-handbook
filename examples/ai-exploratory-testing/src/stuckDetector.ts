export interface StuckOpts {
  thresholdSec: number;
  onStuck: () => void;
}

export class StuckDetector {
  private lastPing = Date.now();
  private timer?: ReturnType<typeof setInterval>;
  constructor(private readonly opts: StuckOpts) {}
  start(): void {
    this.lastPing = Date.now();
    this.timer = setInterval(() => {
      if (Date.now() - this.lastPing >= this.opts.thresholdSec * 1000) {
        this.opts.onStuck();
        this.lastPing = Date.now();
      }
    }, 1000);
  }
  ping(): void { this.lastPing = Date.now(); }
  stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = undefined; } }
}
