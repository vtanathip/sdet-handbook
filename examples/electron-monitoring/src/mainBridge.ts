import type { ElectronApplication } from 'playwright';
import type { MainInspector } from './mainInspector.js';

// Abstracts "run a probe in the Electron main process" so L3/L4/L5 work over EITHER channel:
//  - ElectronAppBridge: Playwright launched the app → electronApp.evaluate (electron module is the arg).
//  - InspectorBridge:   attached to a packaged app's --inspect port → require('electron') via the
//                       Node inspector's command-line API.
// The two channels expose the electron module differently, so each bridge phrases the same probe
// its own way; the detectors stay channel-agnostic.

export interface ProcSample { pid: number; type: string; cpu: number; mem: number }
export interface NativeEvt { kind: string; t: number; details?: unknown }

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
  close(): Promise<void>;
}

const LOOP_INTERVAL = 50;

// ── Source mode: Playwright owns the app ────────────────────────────────────────────────────────
export class ElectronAppBridge implements MainBridge {
  constructor(private readonly app: ElectronApplication) {}

  async startEventLoopMonitor(): Promise<void> {
    await this.app.evaluate((_electron, interval) => {
      const g = globalThis as typeof globalThis & { __elt?: ReturnType<typeof setInterval>; __eltRead?: () => number };
      if (g.__eltRead) return;
      let last = Date.now();
      let max = 0;
      g.__elt = setInterval(() => {
        const now = Date.now();
        const lag = now - last - interval;
        if (lag > max) max = lag;
        last = now;
      }, interval);
      g.__eltRead = () => { const m = max; max = 0; return m; };
    }, LOOP_INTERVAL);
  }

  readEventLoopLagMs(): Promise<number> {
    return this.app.evaluate(() => {
      const g = globalThis as typeof globalThis & { __eltRead?: () => number };
      return g.__eltRead ? g.__eltRead() : 0;
    });
  }

  async stopEventLoopMonitor(): Promise<void> {
    await this.app.evaluate(() => {
      const g = globalThis as typeof globalThis & { __elt?: ReturnType<typeof setInterval> };
      if (g.__elt) clearInterval(g.__elt);
    }).catch(() => {});
  }

  getAppMetrics(): Promise<ProcSample[]> {
    return this.app.evaluate(({ app }) =>
      app.getAppMetrics().map((m) => ({
        pid: m.pid, type: m.type,
        cpu: m.cpu?.percentCPUUsage ?? 0, mem: m.memory?.workingSetSize ?? 0,
      })),
    );
  }

  async wireNativeListeners(): Promise<void> {
    await this.app.evaluate(({ app, webContents }) => {
      const g = globalThis as unknown as { __native?: NativeEvt[]; __nativeWired?: boolean };
      g.__native = g.__native ?? [];
      if (g.__nativeWired) return;
      g.__nativeWired = true;
      const wire = (wc: { on(ev: string, fn: () => void): void }) => {
        wc.on('unresponsive', () => g.__native!.push({ kind: 'unresponsive', t: Date.now() }));
        wc.on('responsive', () => g.__native!.push({ kind: 'responsive', t: Date.now() }));
      };
      for (const wc of webContents.getAllWebContents()) wire(wc);
      app.on('web-contents-created', (_e, wc) => wire(wc));
      app.on('render-process-gone', (_e, _wc, details) => g.__native!.push({ kind: 'render-process-gone', t: Date.now(), details }));
      app.on('child-process-gone', (_e, details) => g.__native!.push({ kind: 'child-process-gone', t: Date.now(), details }));
    });
  }

  drainNative(): Promise<NativeEvt[]> {
    return this.app.evaluate(() => {
      const g = globalThis as unknown as { __native?: NativeEvt[] };
      const e = g.__native ?? [];
      g.__native = [];
      return e;
    });
  }

  async startIpcCounter(): Promise<void> {
    await this.app.evaluate(({ ipcMain }) => {
      const g = globalThis as unknown as { __ipcWrapped?: boolean; __ipcCount?: number };
      if (g.__ipcWrapped) return;
      g.__ipcWrapped = true;
      g.__ipcCount = 0;
      const emitter = ipcMain as unknown as { emit: (...a: unknown[]) => boolean };
      const orig = emitter.emit.bind(emitter);
      emitter.emit = (...a: unknown[]) => { g.__ipcCount = (g.__ipcCount ?? 0) + 1; return orig(...a); };
    });
  }

  readIpcDelta(): Promise<number> {
    return this.app.evaluate(() => {
      const g = globalThis as unknown as { __ipcCount?: number };
      const c = g.__ipcCount ?? 0; g.__ipcCount = 0; return c;
    });
  }

  async close(): Promise<void> { /* Playwright owns the app lifecycle */ }
}

// ── CDP+inspect mode: attached to a packaged app over --inspect ──────────────────────────────────
// Same probes phrased as expression strings using require('electron') (reachable via the inspector
// command-line API). globalThis state persists in the main process across evaluate calls.
export class InspectorBridge implements MainBridge {
  constructor(private readonly insp: MainInspector) {}

  async startEventLoopMonitor(): Promise<void> {
    await this.insp.evaluate(
      `(()=>{const g=globalThis;if(g.__eltRead)return 0;let last=Date.now(),max=0;` +
      `g.__elt=setInterval(()=>{const n=Date.now();const lag=n-last-${LOOP_INTERVAL};if(lag>max)max=lag;last=n;},${LOOP_INTERVAL});` +
      `g.__eltRead=()=>{const m=max;max=0;return m;};return 0;})()`,
    );
  }

  readEventLoopLagMs(): Promise<number> {
    return this.insp.evaluate<number>('globalThis.__eltRead?globalThis.__eltRead():0');
  }

  async stopEventLoopMonitor(): Promise<void> {
    await this.insp.evaluate('(()=>{const g=globalThis;if(g.__elt)clearInterval(g.__elt);return 0;})()').catch(() => {});
  }

  getAppMetrics(): Promise<ProcSample[]> {
    return this.insp.evaluate<ProcSample[]>(
      `require('electron').app.getAppMetrics().map(m=>({pid:m.pid,type:m.type,` +
      `cpu:(m.cpu&&m.cpu.percentCPUUsage)||0,mem:(m.memory&&m.memory.workingSetSize)||0}))`,
    );
  }

  async wireNativeListeners(): Promise<void> {
    await this.insp.evaluate(
      `(()=>{const e=require('electron');const g=globalThis;g.__native=g.__native||[];if(g.__nativeWired)return 0;g.__nativeWired=true;` +
      `const wire=(wc)=>{wc.on('unresponsive',()=>g.__native.push({kind:'unresponsive',t:Date.now()}));wc.on('responsive',()=>g.__native.push({kind:'responsive',t:Date.now()}));};` +
      `e.webContents.getAllWebContents().forEach(wire);e.app.on('web-contents-created',(_e,wc)=>wire(wc));` +
      `e.app.on('render-process-gone',(_e,_wc,d)=>g.__native.push({kind:'render-process-gone',t:Date.now(),details:d}));` +
      `e.app.on('child-process-gone',(_e,d)=>g.__native.push({kind:'child-process-gone',t:Date.now(),details:d}));return 0;})()`,
    );
  }

  drainNative(): Promise<NativeEvt[]> {
    return this.insp.evaluate<NativeEvt[]>('(()=>{const g=globalThis;const e=g.__native||[];g.__native=[];return e;})()');
  }

  async startIpcCounter(): Promise<void> {
    await this.insp.evaluate(
      `(()=>{const {ipcMain}=require('electron');const g=globalThis;if(g.__ipcWrapped)return 0;g.__ipcWrapped=true;g.__ipcCount=0;` +
      `const orig=ipcMain.emit.bind(ipcMain);ipcMain.emit=(...a)=>{g.__ipcCount++;return orig(...a);};return 0;})()`,
    );
  }

  readIpcDelta(): Promise<number> {
    return this.insp.evaluate<number>('(()=>{const g=globalThis;const c=g.__ipcCount||0;g.__ipcCount=0;return c;})()');
  }

  close(): Promise<void> { return this.insp.close(); }
}
