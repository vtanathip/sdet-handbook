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

export interface ProcSample { pid: number; type: string; cpu: number; mem: number }
export interface NativeEvt { kind: string; t: number; details?: unknown }
export interface JsErr { kind: string; message: string; stack: string }

export interface MainBridge {
  startEventLoopMonitor(): Promise<void>;
  readEventLoopLagMs(): Promise<number>;
  stopEventLoopMonitor(): Promise<void>;
  getAppMetrics(): Promise<ProcSample[]>;
  wireNativeListeners(): Promise<void>;
  drainNative(): Promise<NativeEvt[]>;
  /** Patch ipcMain.emit to count renderer→main `send` traffic (the IPC flood/backpressure vector). */
  startIpcCounter(): Promise<void>;
  /** Messages counted since the last read, then reset. */
  readIpcDelta(): Promise<number>;
  /** Capture uncaught exceptions / unhandled rejections in the MAIN process. */
  wireMainErrors(): Promise<void>;
  drainMainErrors(): Promise<JsErr[]>;
  /** The app's userData directory (so the harness can check disk free / I/O latency on that volume). */
  getUserDataPath(): Promise<string>;
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
    metrics:
      `${E}.app.getAppMetrics().map(function(m){return {pid:m.pid,type:m.type,` +
      `cpu:(m.cpu&&m.cpu.percentCPUUsage)||0,mem:(m.memory&&m.memory.workingSetSize)||0};})`,
    wireNative:
      `(function(){var e=${E};var g=globalThis;g.__native=g.__native||[];if(g.__nativeWired)return 0;g.__nativeWired=true;` +
      `var wire=function(wc){wc.on('unresponsive',function(){g.__native.push({kind:'unresponsive',t:Date.now()});});` +
      `wc.on('responsive',function(){g.__native.push({kind:'responsive',t:Date.now()});});};` +
      `e.webContents.getAllWebContents().forEach(wire);e.app.on('web-contents-created',function(_e,wc){wire(wc);});` +
      `e.app.on('render-process-gone',function(_e,_wc,d){g.__native.push({kind:'render-process-gone',t:Date.now(),details:d});});` +
      `e.app.on('child-process-gone',function(_e,d){g.__native.push({kind:'child-process-gone',t:Date.now(),details:d});});return 0;})()`,
    drainNative: `(function(){var g=globalThis;var e=g.__native||[];g.__native=[];return e;})()`,
    startIpc:
      `(function(){var i=${E}.ipcMain;var g=globalThis;if(g.__ipcWrapped)return 0;g.__ipcWrapped=true;g.__ipcCount=0;` +
      `var orig=i.emit.bind(i);i.emit=function(){g.__ipcCount++;return orig.apply(i,arguments);};return 0;})()`,
    readIpc: `(function(){var g=globalThis;var c=g.__ipcCount||0;g.__ipcCount=0;return c;})()`,
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
  readIpcDelta(): Promise<number> { return this.run<number>(this.p.readIpc); }
  wireMainErrors(): Promise<void> { return this.run<number>(this.p.mainErrWire).then(() => {}); }
  drainMainErrors(): Promise<JsErr[]> { return this.run<JsErr[]>(this.p.mainErrDrain); }
  getUserDataPath(): Promise<string> { return this.run<string>(this.p.userData); }
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
  readIpcDelta(): Promise<number> { return this.insp.evaluate<number>(this.p.readIpc); }
  wireMainErrors(): Promise<void> { return this.insp.evaluate<number>(this.p.mainErrWire).then(() => {}); }
  drainMainErrors(): Promise<JsErr[]> { return this.insp.evaluate<JsErr[]>(this.p.mainErrDrain); }
  getUserDataPath(): Promise<string> { return this.insp.evaluate<string>(this.p.userData); }
  close(): Promise<void> { return this.insp.close(); }
}
