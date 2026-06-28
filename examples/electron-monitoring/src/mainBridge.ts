import type { ElectronApplication } from 'playwright';
import type { MainInspector } from './mainInspector.js';

// Abstracts "run a probe in the Electron main process" so L3/L4/L5/L7 work over EITHER channel:
//  - ElectronAppBridge: Playwright launched the app → electronApp.evaluate.
//  - InspectorBridge:   attached to a packaged app's --inspect port → Node inspector Runtime.evaluate.
//
// Both run the SAME probe bodies, authored as plain strings (below). Strings are never touched by the
// bundler — this sidesteps esbuild/tsx's `__name` helper, which isn't defined in the main process and
// otherwise breaks `electronApp.evaluate(fn)` when run under tsx (e.g. `npm run watch`). The only
// difference between channels is how they reach the electron module: the arg `electron` (Playwright)
// vs `require('electron')` (inspector command-line API).

export interface ProcSample {
  pid: number; type: string; cpu: number; mem: number;
  // Reclaimed from getAppMetrics() so L4 can name the culprit (was discarded before):
  name?: string;       // utility-process name: 'Network Service', 'Audio Service', … (else '')
  peakMem?: number;    // peakWorkingSetSize KB — steady leak (≈current) vs drained spike (»current)
  wakeups?: number;    // idleWakeupsPerSecond — high+lowCPU = busy-poll/timer storm (0 on Windows)
  cpuTime?: number;    // cumulativeCPUUsage seconds
}
export interface NativeEvt {
  kind: string; t: number; details?: unknown;
  // webContents identity so L5 can say WHICH window/renderer (was dropped before):
  wcId?: number; url?: string; title?: string; wcType?: string;
}
export interface JsErr { kind: string; message: string; stack: string }
export interface ChildEvt {
  kind: string; pid: number; cmd: string; code?: number; signal?: string; message?: string; t: number;
  argv?: string;        // binary + args, so the report names WHICH call/input crashed
  stderrTail?: string;  // last ~2KB of the child's stderr — the actual error text (the root cause)
}
export interface LiveChild { pid: number; cmd: string; ageMs: number }
/** One timed ipcMain handler invocation, so L3 can name the handler that blocked the loop. */
export interface IpcTiming { channel: string; kind: 'on' | 'handle'; durationMs: number; ts: number }

export interface MainBridge {
  startEventLoopMonitor(): Promise<void>;
  readEventLoopLagMs(): Promise<number>;
  stopEventLoopMonitor(): Promise<void>;
  getAppMetrics(): Promise<ProcSample[]>;
  wireNativeListeners(): Promise<void>;
  drainNative(): Promise<NativeEvt[]>;
  /** Patch ipcMain.emit + ipcMain.handle to count renderer→main traffic PER CHANNEL (send + invoke). */
  startIpcCounter(): Promise<void>;
  /** Per-channel counts since the last read, keyed `send:<ch>` / `invoke:<ch>`, then reset. */
  readIpcCounts(): Promise<Record<string, number>>;
  /** Wrap every ipcMain.on/handle handler to time each invocation (names the loop-blocking handler). */
  startIpcHandlerTimer(): Promise<void>;
  /** Drained per-invocation timings since the last read, then reset. */
  drainIpcHandlerTimings(): Promise<IpcTiming[]>;
  /** Capture uncaught exceptions / unhandled rejections in the MAIN process. */
  wireMainErrors(): Promise<void>;
  drainMainErrors(): Promise<JsErr[]>;
  /** The app's userData directory (so the harness can check disk free / I/O latency on that volume). */
  getUserDataPath(): Promise<string>;
  /** Patch child_process to track spawned children. Returns false when unsupported (source mode has
   *  no `require` in the eval scope — only the inspector channel can do this). */
  wireChildProcs(): Promise<boolean>;
  drainChildProcs(): Promise<ChildEvt[]>;
  readLiveChildren(): Promise<LiveChild[]>;
  close(): Promise<void>;
}

const LOOP = 50;

// Probe bodies as strings. `E` is the expression that yields the electron module in the target.
function probes(E: string) {
  return {
    startLoop:
      `(function(){var g=globalThis;if(g.__eltRead)return 0;var last=Date.now(),max=0;` +
      `g.__elt=setInterval(function(){var n=Date.now();var lag=n-last-${LOOP};if(lag>max)max=lag;last=n;},${LOOP});` +
      `g.__eltRead=function(){var m=max;max=0;return m;};return 0;})()`,
    readLoop: `(globalThis.__eltRead?globalThis.__eltRead():0)`,
    stopLoop: `(function(){var g=globalThis;if(g.__elt)clearInterval(g.__elt);return 0;})()`,
    // L4: keep the fields that name a culprit — name (which utility), peakMem (leak vs spike),
    // wakeups (timer storm even when cpu% reads low), cpuTime — all already returned by getAppMetrics.
    metrics:
      `${E}.app.getAppMetrics().map(function(m){return {pid:m.pid,type:m.type,` +
      `name:(m.name||m.serviceName||''),` +
      `cpu:(m.cpu&&m.cpu.percentCPUUsage)||0,` +
      `wakeups:(m.cpu&&m.cpu.idleWakeupsPerSecond)||0,` +
      `cpuTime:(m.cpu&&m.cpu.cumulativeCPUUsage)||0,` +
      `mem:(m.memory&&m.memory.workingSetSize)||0,` +
      `peakMem:(m.memory&&m.memory.peakWorkingSetSize)||0};})`,
    // L5: capture webContents identity (id/url/title/type) on unresponsive/responsive AND on
    // render-process-gone (use the wc arg, not _wc) so the report names WHICH window died.
    wireNative:
      `(function(){var e=${E};var g=globalThis;g.__native=g.__native||[];if(g.__nativeWired)return 0;g.__nativeWired=true;` +
      `var wire=function(wc){var idf=function(){var o={};try{o.wcId=wc.id;o.url=wc.getURL();o.title=wc.getTitle();o.wcType=wc.getType();}catch(_){}return o;};` +
      `wc.on('unresponsive',function(){var o=idf();o.kind='unresponsive';o.t=Date.now();g.__native.push(o);});` +
      `wc.on('responsive',function(){var o=idf();o.kind='responsive';o.t=Date.now();g.__native.push(o);});};` +
      `e.webContents.getAllWebContents().forEach(wire);e.app.on('web-contents-created',function(_e,wc){wire(wc);});` +
      `e.app.on('render-process-gone',function(_e,wc,d){var o={kind:'render-process-gone',t:Date.now(),details:d};try{o.wcId=wc.id;o.url=wc.getURL();o.title=wc.getTitle();o.wcType=wc.getType();}catch(_){}g.__native.push(o);});` +
      `e.app.on('child-process-gone',function(_e,d){g.__native.push({kind:'child-process-gone',t:Date.now(),details:d});});return 0;})()`,
    drainNative: `(function(){var g=globalThis;var e=g.__native||[];g.__native=[];return e;})()`,
    // L7: count PER CHANNEL (so the report names the flooding channel) and also wrap ipcMain.handle so
    // invoke traffic is counted (it bypasses emit). Keys are namespaced by transport.
    startIpc:
      `(function(){var i=${E}.ipcMain;var g=globalThis;if(g.__ipcWrapped)return 0;g.__ipcWrapped=true;g.__ipc={};` +
      `var bump=function(k){g.__ipc[k]=(g.__ipc[k]||0)+1;};` +
      `var orig=i.emit.bind(i);i.emit=function(ch){if(typeof ch==='string')bump('send:'+ch);return orig.apply(i,arguments);};` +
      `var oh=i.handle.bind(i);i.handle=function(ch,fn){return oh(ch,function(){bump('invoke:'+ch);return fn.apply(this,arguments);});};return 0;})()`,
    readIpc: `(function(){var g=globalThis;var c=g.__ipc||{};g.__ipc={};return c;})()`,
    // L3: time every ipcMain handler invocation so the loop-blocking handler is named. Wraps on/once/
    // addListener + handle for future registrations AND re-wraps handlers already registered before we
    // attached (the demo registers all of them at startup). Bare Date.now() pair per call — cheap.
    startTimer:
      `(function(){var i=${E}.ipcMain;var g=globalThis;if(g.__ipcTimerWired)return 0;g.__ipcTimerWired=true;g.__ipcTimes=g.__ipcTimes||[];` +
      `var push=function(ch,kind,t0){g.__ipcTimes.push({channel:ch,kind:kind,durationMs:Date.now()-t0,ts:t0});if(g.__ipcTimes.length>200)g.__ipcTimes.shift();};` +
      `var wrapL=function(ch,fn){if(!fn||fn.__ipcTimed)return fn;var w=function(){var t0=Date.now();try{return fn.apply(this,arguments);}finally{push(ch,'on',t0);}};w.__ipcTimed=true;return w;};` +
      `var oOn=i.on.bind(i);i.on=function(ch,fn){return oOn(ch,wrapL(ch,fn));};` +
      `var oAdd=i.addListener.bind(i);i.addListener=function(ch,fn){return oAdd(ch,wrapL(ch,fn));};` +
      `var oOnce=i.once.bind(i);i.once=function(ch,fn){return oOnce(ch,wrapL(ch,fn));};` +
      `i.eventNames().forEach(function(ch){i.rawListeners(ch).forEach(function(fn){if(!fn.__ipcTimed){i.removeListener(ch,fn);oOn(ch,wrapL(ch,fn));}});});` +
      `var oHandle=i.handle.bind(i);i.handle=function(ch,fn){var w=function(){var t0=Date.now();var r=fn.apply(this,arguments);` +
      `if(r&&typeof r.then==='function'){return r.then(function(v){push(ch,'handle',t0);return v;},function(err){push(ch,'handle',t0);throw err;});}push(ch,'handle',t0);return r;};return oHandle(ch,w);};` +
      `var H=i._invokeHandlers;if(H&&H.forEach){var re=[];H.forEach(function(fn,ch){re.push([ch,fn]);});re.forEach(function(p){if(i.removeHandler)i.removeHandler(p[0]);i.handle(p[0],p[1]);});}return 0;})()`,
    drainTimings: `(function(){var g=globalThis;var e=g.__ipcTimes||[];g.__ipcTimes=[];return e;})()`,
    mainErrWire:
      `(function(){var g=globalThis;g.__jserr=g.__jserr||[];if(g.__jserrWired)return 0;g.__jserrWired=true;` +
      `process.on('uncaughtException',function(e){g.__jserr.push({kind:'main-uncaughtException',message:String((e&&e.message)||e),stack:String((e&&e.stack)||'')});});` +
      `process.on('unhandledRejection',function(r){g.__jserr.push({kind:'main-unhandledRejection',message:String((r&&r.message)||r),stack:String((r&&r.stack)||'')});});return 0;})()`,
    mainErrDrain: `(function(){var g=globalThis;var e=g.__jserr||[];g.__jserr=[];return e;})()`,
    userData: `${E}.app.getPath('userData')`,
  };
}

// ── Source mode: Playwright owns the app ────────────────────────────────────────────────────────
export class ElectronAppBridge implements MainBridge {
  private readonly p = probes('electron');
  constructor(private readonly app: ElectronApplication) {}

  // Build via new Function so the evaluated source is a pristine string (no bundler __name helper).
  // electronApp.evaluate passes the electron module as the first argument → named `electron` here.
  private run<T>(body: string): Promise<T> {
    const fn = new Function('electron', `return (${body});`);
    return (this.app.evaluate as unknown as (f: unknown) => Promise<T>)(fn);
  }

  startEventLoopMonitor(): Promise<void> { return this.run<number>(this.p.startLoop).then(() => {}); }
  readEventLoopLagMs(): Promise<number> { return this.run<number>(this.p.readLoop); }
  stopEventLoopMonitor(): Promise<void> { return this.run<number>(this.p.stopLoop).then(() => {}).catch(() => {}); }
  getAppMetrics(): Promise<ProcSample[]> { return this.run<ProcSample[]>(this.p.metrics); }
  wireNativeListeners(): Promise<void> { return this.run<number>(this.p.wireNative).then(() => {}); }
  drainNative(): Promise<NativeEvt[]> { return this.run<NativeEvt[]>(this.p.drainNative); }
  startIpcCounter(): Promise<void> { return this.run<number>(this.p.startIpc).then(() => {}); }
  readIpcCounts(): Promise<Record<string, number>> { return this.run<Record<string, number>>(this.p.readIpc); }
  startIpcHandlerTimer(): Promise<void> { return this.run<number>(this.p.startTimer).then(() => {}); }
  drainIpcHandlerTimings(): Promise<IpcTiming[]> { return this.run<IpcTiming[]>(this.p.drainTimings); }
  wireMainErrors(): Promise<void> { return this.run<number>(this.p.mainErrWire).then(() => {}); }
  drainMainErrors(): Promise<JsErr[]> { return this.run<JsErr[]>(this.p.mainErrDrain); }
  getUserDataPath(): Promise<string> { return this.run<string>(this.p.userData); }
  // child_process patching needs `require`, which isn't in scope for electronApp.evaluate — unsupported.
  async wireChildProcs(): Promise<boolean> { return false; }
  async drainChildProcs(): Promise<ChildEvt[]> { return []; }
  async readLiveChildren(): Promise<LiveChild[]> { return []; }
  async close(): Promise<void> { /* Playwright owns the app lifecycle */ }
}

// ── CDP+inspect mode: attached to a packaged app over --inspect ──────────────────────────────────
export class InspectorBridge implements MainBridge {
  private readonly p = probes("require('electron')");
  constructor(private readonly insp: MainInspector) {}

  startEventLoopMonitor(): Promise<void> { return this.insp.evaluate<number>(this.p.startLoop).then(() => {}); }
  readEventLoopLagMs(): Promise<number> { return this.insp.evaluate<number>(this.p.readLoop); }
  stopEventLoopMonitor(): Promise<void> { return this.insp.evaluate<number>(this.p.stopLoop).then(() => {}).catch(() => {}); }
  getAppMetrics(): Promise<ProcSample[]> { return this.insp.evaluate<ProcSample[]>(this.p.metrics); }
  wireNativeListeners(): Promise<void> { return this.insp.evaluate<number>(this.p.wireNative).then(() => {}); }
  drainNative(): Promise<NativeEvt[]> { return this.insp.evaluate<NativeEvt[]>(this.p.drainNative); }
  startIpcCounter(): Promise<void> { return this.insp.evaluate<number>(this.p.startIpc).then(() => {}); }
  readIpcCounts(): Promise<Record<string, number>> { return this.insp.evaluate<Record<string, number>>(this.p.readIpc); }
  startIpcHandlerTimer(): Promise<void> { return this.insp.evaluate<number>(this.p.startTimer).then(() => {}); }
  drainIpcHandlerTimings(): Promise<IpcTiming[]> { return this.insp.evaluate<IpcTiming[]>(this.p.drainTimings); }
  wireMainErrors(): Promise<void> { return this.insp.evaluate<number>(this.p.mainErrWire).then(() => {}); }
  drainMainErrors(): Promise<JsErr[]> { return this.insp.evaluate<JsErr[]>(this.p.mainErrDrain); }
  getUserDataPath(): Promise<string> { return this.insp.evaluate<string>(this.p.userData); }
  async wireChildProcs(): Promise<boolean> {
    return (await this.insp.evaluate<boolean>(
      `(function(){var cp=require('child_process');var g=globalThis;if(g.__cpWired)return true;g.__cpWired=true;g.__cpEvents=[];g.__cpLive={};var seq=0;` +
      `function track(c,cmd,argv){var id=++seq;g.__cpLive[id]={pid:c.pid,cmd:cmd,argv:argv,startTs:Date.now(),err:''};g.__cpEvents.push({kind:'spawn',pid:c.pid,cmd:cmd,argv:argv,t:Date.now()});` +
      // stderr-only tail (not stdout): stderr is the error text; draining stdout could mask a real
      // pipe-buffer deadlock. Guarded — null when the app spawned with stdio:'inherit'|'ignore'.
      `if(c.stderr){c.stderr.on('data',function(b){var s=g.__cpLive[id];if(s){s.err=(s.err+String(b)).slice(-2000);}});}` +
      `c.on('exit',function(code,signal){var s=g.__cpLive[id];var tail=s?s.err:'';delete g.__cpLive[id];g.__cpEvents.push({kind:'exit',pid:c.pid,cmd:cmd,argv:argv,code:code,signal:signal,stderrTail:tail,t:Date.now()});});` +
      `c.on('error',function(e){g.__cpEvents.push({kind:'error',pid:c.pid,cmd:cmd,argv:argv,message:String((e&&e.message)||e),t:Date.now()});});}` +
      `function mkargv(a){return (String(a[0])+(Array.isArray(a[1])?' '+a[1].slice(0,12).join(' '):'')).slice(0,300);}` +
      `['spawn','fork'].forEach(function(m){var o=cp[m];cp[m]=function(){var c=o.apply(cp,arguments);try{track(c,String(arguments[0]),mkargv(arguments));}catch(_){}return c;};});` +
      `['exec','execFile'].forEach(function(m){var o=cp[m];cp[m]=function(){var c=o.apply(cp,arguments);try{if(c&&c.pid)track(c,String(arguments[0]),mkargv(arguments));}catch(_){}return c;};});` +
      `return true;})()`,
    )) === true;
  }
  drainChildProcs(): Promise<ChildEvt[]> {
    return this.insp.evaluate<ChildEvt[]>('(function(){var g=globalThis;var e=g.__cpEvents||[];g.__cpEvents=[];return e;})()');
  }
  readLiveChildren(): Promise<LiveChild[]> {
    return this.insp.evaluate<LiveChild[]>('(function(){var g=globalThis;var o=[];var now=Date.now();var L=g.__cpLive||{};for(var k in L){o.push({pid:L[k].pid,cmd:L[k].cmd,ageMs:now-L[k].startTs});}return o;})()');
  }
  close(): Promise<void> { return this.insp.close(); }
}
