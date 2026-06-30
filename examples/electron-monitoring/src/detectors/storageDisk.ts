import { statfsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Detector, DetectorCtx } from '../detector.js';
import { JsonlWriter } from '../util/jsonl.js';
import { log } from '../util/logger.js';

// Storage & disk — quota/pressure AND what the app actually writes.
//  - storage-pressure: navigator.storage.estimate() per renderer (usage vs quota) — works in ALL modes.
//  - disk-low / slow-disk: the harness's OWN Node process checks free space + write latency on the
//    app's userData volume (we only ask the bridge for the path — fs work runs here, sidestepping the
//    no-require-in-evaluate limit). Needs a main-process channel (source or cdp+inspect) for the path.
//  - storage OPS: patch Storage.prototype in the renderer to log every localStorage/sessionStorage
//    setItem/removeItem/clear the app makes while running (key, byte size, preview) — no app
//    cooperation. Plus a start/end snapshot of what's in storage. → storage-ops.jsonl.

interface Estimate { usage?: number; quota?: number; usageDetails?: Record<string, number>; origin?: string }

// Renderer patch (string → bundler-safe). Wraps Storage.prototype so BOTH localStorage and
// sessionStorage are covered; `this` tells which area. previewChars caps the captured value.
// Exported for the self-check (run against a stub Storage, no Electron needed).
export function storageTapSource(cap: number): string {
  return `(function(){var w=window;if(w.__lsTap)return 0;var P=(typeof Storage!=='undefined')&&Storage.prototype;if(!P)return 0;w.__lsTap=true;w.__lsOps=[];var CAP=${cap};var MAX=50000;` +
    `var area=function(t){try{return t===w.localStorage?'local':t===w.sessionStorage?'session':'other';}catch(e){return 'other';}};` +
    // site(): the APP call-site that did the write — first stack frame with a real URL (our injected
    // wrapper + storage internals have no URL), formatted 'fnName @ file:line'. This is the "who wrote it".
    `var site=function(){try{var st=((new Error()).stack||'').split('\\n');for(var i=2;i<st.length;i++){var L=st[i];if(L.indexOf('<anonymous>')>=0)continue;var m=L.match(/\\(?((?:[a-z][a-z0-9+.-]*:\\/\\/|\\/)[^()\\s]*?:\\d+:\\d+)\\)?\\s*$/);if(!m)continue;var fn=(L.match(/at\\s+([^(\\s]+)/)||[])[1]||'(anonymous)';return fn+' @ '+m[1].split(/[\\\\/]/).pop();}}catch(e){}return '';};` +
    `var rec=function(op,t,key,val){if(w.__lsOps.length>=MAX)return;w.__lsOps.push({ts:Date.now(),area:area(t),op:op,key:key==null?null:String(key).slice(0,200),valueBytes:val==null?0:String(val).length,preview:val==null?'':String(val).slice(0,CAP),at:site()});};` +
    `var os=P.setItem;P.setItem=function(k,v){rec('set',this,k,v);return os.apply(this,arguments);};` +
    `var orm=P.removeItem;P.removeItem=function(k){rec('remove',this,k,null);return orm.apply(this,arguments);};` +
    `var oc=P.clear;P.clear=function(){rec('clear',this,null,null);return oc.apply(this,arguments);};` +
    `var snap=function(s){var o=[];try{for(var i=0;i<s.length;i++){var k=s.key(i);o.push({key:k,bytes:(s.getItem(k)||'').length});}}catch(e){}return o;};` +
    `w.__lsDrain=function(){var e=w.__lsOps;w.__lsOps=[];return e;};` +
    `w.__lsSnapshot=function(){return {local:snap(w.localStorage),session:snap(w.sessionStorage)};};return 0;})()`;
}

export class StorageDisk implements Detector {
  readonly name = 'storage';
  private out: JsonlWriter;
  private ops: JsonlWriter;
  private timer?: ReturnType<typeof setInterval>;
  private inflight = false;
  private userDataPath?: string;
  private opsWritten = 0;
  private pressureEmitted = false;
  private diskLowEmitted = false;
  private slowDiskEmitted = false;
  constructor(private readonly ctx: DetectorCtx) {
    this.out = new JsonlWriter(join(ctx.runDir, 'storage.jsonl'));
    this.ops = new JsonlWriter(join(ctx.runDir, 'storage-ops.jsonl'));
  }

  async start(): Promise<void> {
    if (this.ctx.mainBridge) {
      this.userDataPath = await this.ctx.mainBridge.getUserDataPath().catch(() => undefined);
    }
    // Patch Storage.prototype in the renderer to log every localStorage/sessionStorage write.
    const src = storageTapSource(this.ctx.config.previewChars);
    await this.ctx.page.addInitScript({ content: src });
    await this.ctx.page.evaluate(src).catch(() => {});
    this.timer = setInterval(() => { void this.poll(); }, 2000);
  }

  // Drain buffered localStorage/sessionStorage ops into storage-ops.jsonl.
  private async drainOps(): Promise<void> {
    if (!this.ctx.config.captureAll) return;
    const ops = (await this.ctx.page.evaluate('(window.__lsDrain && window.__lsDrain()) || []').catch(() => [])) as unknown[];
    for (const o of ops) {
      if (this.opsWritten >= this.ctx.config.streamMaxEvents) break;
      await this.ops.append(o);
      this.opsWritten++;
    }
  }

  private async poll(): Promise<void> {
    if (this.inflight) return;
    this.inflight = true;
    try {
      const est = (await this.ctx.page
        .evaluate(() => (navigator.storage?.estimate
          ? navigator.storage.estimate().then((e) => ({
              usage: e.usage, quota: e.quota,
              usageDetails: (e as { usageDetails?: Record<string, number> }).usageDetails,
              origin: location.origin,
            }))
          : null))
        .catch(() => null)) as Estimate | null;

      let freeBytes = -1;
      let ioMs = -1;
      if (this.userDataPath) {
        try { const s = statfsSync(this.userDataPath); freeBytes = s.bavail * s.bsize; } catch { /* ignore */ }
        try {
          const f = join(this.userDataPath, '.em-io-canary');
          const t = Date.now();
          writeFileSync(f, 'x');
          unlinkSync(f);
          ioMs = Date.now() - t;
        } catch { /* ignore */ }
      }
      await this.out.append({ ts: new Date().toISOString(), est, freeBytes, ioMs });
      await this.drainOps();
      this.check(est, freeBytes, ioMs);
    } catch {
      /* page/app closing — ignore */
    } finally {
      this.inflight = false;
    }
  }

  private check(est: Estimate | null, freeBytes: number, ioMs: number): void {
    const ts = new Date().toISOString();
    if (!this.pressureEmitted && est?.usage && est?.quota && est.quota > 0) {
      const pct = est.usage / est.quota;
      if (pct >= this.ctx.config.storagePct) {
        this.pressureEmitted = true;
        // Name the biggest storage SYSTEM (indexedDB/caches/…) so the engineer knows what to prune.
        const top = Object.entries(est.usageDetails ?? {}).sort((a, b) => b[1] - a[1])[0];
        this.ctx.bus.emit({
          layer: 'storage', startIso: ts, durationMs: 0, severity: 'MODERATE',
          detail: { kind: 'storage-pressure', pct: Math.round(pct * 100), usageKB: Math.round(est.usage / 1024), quotaKB: Math.round(est.quota / 1024),
            biggest: top ? `${top[0]} ${Math.round(top[1] / 1024)}KB` : '', origin: est.origin },
        });
        log('warn', `[STORAGE] usage ${Math.round(pct * 100)}% of quota`);
      }
    }
    if (!this.diskLowEmitted && freeBytes >= 0 && freeBytes < this.ctx.config.diskLowBytes) {
      this.diskLowEmitted = true;
      this.ctx.bus.emit({
        layer: 'storage', startIso: ts, durationMs: 0, severity: 'SEVERE',
        detail: { kind: 'disk-low', freeKB: Math.round(freeBytes / 1024), path: this.userDataPath },
      });
      log('error', `[STORAGE] disk low: ${Math.round(freeBytes / 1024 / 1024)}MB free`);
    }
    if (!this.slowDiskEmitted && ioMs >= 0 && ioMs > this.ctx.config.ioSlowMs) {
      this.slowDiskEmitted = true;
      this.ctx.bus.emit({
        layer: 'storage', startIso: ts, durationMs: 0, severity: 'MODERATE',
        detail: { kind: 'slow-disk', ms: ioMs, path: this.userDataPath },
      });
      log('warn', `[STORAGE] slow disk: ${ioMs}ms for a tiny userData write`);
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.poll();
    // Final snapshot of what the app left in storage (keys + byte sizes).
    try {
      const snap = await this.ctx.page.evaluate('window.__lsSnapshot ? window.__lsSnapshot() : null').catch(() => null) as { local: unknown[]; session: unknown[] } | null;
      if (snap) await this.ops.append({ ts: new Date().toISOString(), kind: 'snapshot', ...snap });
    } catch { /* page closed */ }
    await this.out.close();
    await this.ops.close();
  }
}
