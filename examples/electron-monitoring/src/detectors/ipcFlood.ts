import { join } from 'node:path';
import type { Detector, DetectorCtx } from '../detector.js';
import type { IpcMessage } from '../mainBridge.js';
import { JsonlWriter } from '../util/jsonl.js';
import { log } from '../util/logger.js';

// L7 — IPC: full capture + flood/backpressure detection.
// We tap EVERY IPC message, both directions, and stream it to `ipc.jsonl` (shapes+previews, no full
// bodies). Two taps, picked by what's reachable:
//   • MAIN tap (preferred): patches ipcMain.emit/handle + webContents.send in the main process via the
//     bridge. Sees ALL windows, immune to contextIsolation. Needs main access (source mode, or attach
//     with --inspect).
//   • RENDERER tap (fallback): when there's no main channel (plain CDP, no --inspect), patches
//     ipcRenderer.send/sendSync/invoke/on in the renderer. Captures renderer→main + incoming main→
//     renderer, WITHOUT the app logging anything — but only if ipcRenderer is reachable in the page
//     world (nodeIntegration / window.require; a contextIsolated app hides it and we warn).
// On top of the stream we keep the freeze signal: a per-interval storm above the threshold emits an
// `ipc-storm` incident naming the top channel.

// Renderer-side tap, authored as a STRING so the bundler never rewrites it (same reason the main-side
// probes are strings — esbuild's __name helper isn't defined in the page). previewChars is baked in.
// Exported for the self-check (run against a stub ipcRenderer, no Electron needed).
export function rendererTapSource(cap: number): string {
  return `(function(){var w=window;if(w.__ipcRTap)return 0;var ir;` +
    `try{ir=w.require&&w.require('electron').ipcRenderer;}catch(e){}if(!ir){try{ir=require('electron').ipcRenderer;}catch(e){}}` +
    `if(!ir||!ir.send){w.__ipcRUnavailable=true;return 0;}w.__ipcRTap=true;w.__ipcR=[];var CAP=${cap};var MAX=200000;` +
    // site(): the APP call-site that issued this IPC — first stack frame with a real URL (our wrapper
    // has none), 'fnName @ file:line'. This is the "which service called it" the report keys on.
    `var site=function(){try{var st=((new Error()).stack||'').split('\\n');for(var i=2;i<st.length;i++){var L=st[i];if(L.indexOf('<anonymous>')>=0)continue;var m=L.match(/\\(?((?:[a-z][a-z0-9+.-]*:\\/\\/|\\/)[^()\\s]*?:\\d+:\\d+)\\)?\\s*$/);if(!m)continue;var fn=(L.match(/at\\s+([^(\\s]+)/)||[])[1]||'(anonymous)';return fn+' @ '+m[1].split(/[\\\\/]/).pop();}}catch(e){}return '';};` +
    `var shape=function(a,from){var t=[],b=0,p=[],u=0;for(var k=from;k<a.length;k++){var x=a[k];t.push(typeof x);var s;try{s=(typeof x==='string')?x:JSON.stringify(x);}catch(e){s=String(x);}if(s==null)s=String(x);b+=s.length;if(u<CAP){p.push(s.slice(0,CAP));u+=s.length;}}return{bytes:b,argTypes:t,preview:p.join(' | ').slice(0,CAP)};};` +
    `var rec=function(tr,ch,dir,a,from,ex){if(w.__ipcR.length>=MAX)return;var sh=shape(a,from);var o={t:Date.now(),transport:tr,channel:ch,dir:dir,bytes:sh.bytes,argTypes:sh.argTypes,preview:sh.preview,at:(dir==='r2m'?site():'')};if(ex)for(var kk in ex)o[kk]=ex[kk];w.__ipcR.push(o);};` +
    `var os=ir.send.bind(ir);ir.send=function(ch){if(typeof ch==='string')rec('send',ch,'r2m',arguments,1);return os.apply(ir,arguments);};` +
    `var oss=ir.sendSync.bind(ir);ir.sendSync=function(ch){if(typeof ch==='string')rec('sendSync',ch,'r2m',arguments,1);return oss.apply(ir,arguments);};` +
    `var oi=ir.invoke?ir.invoke.bind(ir):null;if(oi)ir.invoke=function(ch){var t0=Date.now();if(typeof ch==='string')rec('invoke',ch,'r2m',arguments,1);var p=oi.apply(ir,arguments);return (p&&p.then)?p.then(function(v){rec('invoke-reply',ch,'m2r',[v],0,{latencyMs:Date.now()-t0});return v;},function(e){rec('invoke-reply',ch,'m2r',[String((e&&e.message)||e)],0,{latencyMs:Date.now()-t0,error:true});throw e;}):p;};` +
    // incoming main→renderer: wrap registrations so each delivered message is recorded (skip the event arg).
    `var oon=ir.on.bind(ir);ir.on=function(ch,fn){return oon(ch,function(){if(typeof ch==='string')rec('send',ch,'m2r',arguments,1);return fn.apply(this,arguments);});};` +
    `w.__ipcRDrain=function(){var e=w.__ipcR;w.__ipcR=[];return e;};return 0;})()`;
}

export class IpcFlood implements Detector {
  readonly name = 'ipc';
  private timer?: ReturnType<typeof setInterval>;
  private inflight = false;
  private renderer = false;        // true when the renderer tap is the PRIMARY stream (no main channel)
  private rendererReachable = false;
  private out: JsonlWriter;
  private callsites?: JsonlWriter; // channel→call-site harvested from the renderer tap in main mode
  private written = 0;
  private dropped = 0;
  constructor(private readonly ctx: DetectorCtx) {
    this.out = new JsonlWriter(join(ctx.runDir, 'ipc.jsonl'));
  }

  async start(): Promise<void> {
    // Always install the renderer-side tap — it's the ONLY place the app call-site (which service
    // called which channel) is visible. Whether it's the primary stream or just the call-site source
    // depends on whether a main channel exists.
    const src = rendererTapSource(this.ctx.config.previewChars);
    await this.ctx.page.addInitScript({ content: src });          // future navigations
    await this.ctx.page.evaluate(src).catch(() => {});            // and the already-loaded page
    this.rendererReachable = (await this.ctx.page.evaluate('!!window.__ipcRTap').catch(() => false)) as boolean;

    if (this.ctx.mainBridge) {
      // Main tap is the primary stream (all windows, both directions, immune to contextIsolation).
      await this.ctx.mainBridge.startIpcTap(this.ctx.config.previewChars);
      this.renderer = false;
      if (this.rendererReachable) {
        this.callsites = new JsonlWriter(join(this.ctx.runDir, 'ipc-callsites.jsonl'));
        log('info', '[L7] main-process tap + renderer call-site recorder (full coverage + traceability)');
      } else {
        log('info', '[L7] main-process tap (app call-site unavailable — contextIsolation/no nodeIntegration hides ipcRenderer from the page)');
      }
    } else if (this.rendererReachable) {
      this.renderer = true; // primary stream = renderer tap (its records already carry the call-site)
      log('info', '[L7] renderer-side ipcRenderer tap (with app call-site)');
    } else {
      log('warn', '[L7] no main channel and ipcRenderer is not reachable in the page world '
        + '(contextIsolation / no nodeIntegration) — IPC not captured. Launch the build with --inspect '
        + 'to tap IPC from the main process instead.');
      return; // nothing to poll
    }
    this.timer = setInterval(() => { void this.poll(); }, this.ctx.config.metricsIntervalMs);
  }

  // Main mode: drain the renderer tap purely to harvest call-sites (full payload comes from the main tap).
  private async drainCallsites(): Promise<void> {
    if (!this.callsites) return;
    const evs = (await this.ctx.page.evaluate('(window.__ipcRDrain && window.__ipcRDrain()) || []').catch(() => [])) as IpcMessage[];
    for (const m of evs) {
      if (m.dir !== 'r2m' || !m.at) continue;
      await this.callsites.append({ t: m.t, channel: m.channel, transport: m.transport, at: m.at });
    }
  }

  private async drain(): Promise<{ events: IpcMessage[]; dropped: number }> {
    if (this.renderer) {
      const events = (await this.ctx.page.evaluate('(window.__ipcRDrain && window.__ipcRDrain()) || []').catch(() => [])) as IpcMessage[];
      return { events, dropped: 0 };
    }
    return this.ctx.mainBridge!.drainIpcTap();
  }

  private async poll(): Promise<void> {
    if (this.inflight) return;
    this.inflight = true;
    try {
      const { events, dropped } = await this.drain();
      this.dropped += dropped;
      for (const m of events) {
        if (this.written >= this.ctx.config.streamMaxEvents) { this.dropped++; continue; }
        await this.out.append(m);
        this.written++;
      }
      this.emitStormIfFlooding(events);
      if (!this.renderer) await this.drainCallsites(); // main mode: harvest app call-sites alongside
    } catch {
      /* app closing — ignore */
    } finally {
      this.inflight = false;
    }
  }

  // The freeze path: renderer→main traffic that backs up the main loop. Replies aren't pressure.
  private emitStormIfFlooding(events: IpcMessage[]): void {
    const counts: Record<string, number> = {};
    let msgs = 0;
    for (const m of events) {
      if (m.transport === 'invoke-reply' || m.dir === 'm2r') continue;
      const key = `${m.transport === 'sendSync' ? 'send' : m.transport}:${m.channel}`;
      counts[key] = (counts[key] ?? 0) + 1;
      msgs++;
    }
    if (msgs <= 0) return;
    const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const ratePerSec = Math.round((msgs / this.ctx.config.metricsIntervalMs) * 1000);
    const channels = ranked.slice(0, 3).map(([k, count]) => {
      const i = k.indexOf(':');
      return { transport: k.slice(0, i), channel: k.slice(i + 1), count };
    });
    if (msgs >= this.ctx.config.ipcStormMsgs) {
      const top = channels[0];
      const topPct = Math.round((top.count / msgs) * 100);
      this.ctx.bus.emit({
        layer: 'ipc',
        startIso: new Date(Date.now() - this.ctx.config.metricsIntervalMs).toISOString(),
        durationMs: this.ctx.config.metricsIntervalMs,
        severity: 'MODERATE',
        detail: { kind: 'ipc-storm', msgs, ratePerSec, topChannel: top.channel, topTransport: top.transport, topPct, channels },
      });
      log('warn', `[L7] IPC storm: ${msgs} msgs (~${ratePerSec}/s) — top '${top.transport}:${top.channel}' ${topPct}%`);
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.timer) await this.poll();
    if (this.dropped > 0) log('warn', `[L7] ipc.jsonl capped at ${this.ctx.config.streamMaxEvents} — dropped ${this.dropped} messages`);
    await this.out.close();
    await this.callsites?.close();
  }
}
