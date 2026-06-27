import { log } from './util/logger.js';

// Minimal Node Inspector (CDP-over-websocket) client for the Electron MAIN process.
// The main process is Node, not Chromium, so it's reached via --inspect (a separate port from
// --remote-debugging-port). Uses the global WebSocket (Node ≥21) — no extra dependency.
// `includeCommandLineAPI: true` is what makes `require('electron')` reachable in the eval scope.
export class MainInspector {
  private ws!: WebSocket;
  private nextId = 0;
  private pending = new Map<number, (d: { id: number; result?: unknown }) => void>();

  static async connect(httpEndpoint: string): Promise<MainInspector> {
    const base = httpEndpoint.replace(/\/+$/, '');
    const targets = (await (await fetch(base + '/json')).json()) as Array<{ webSocketDebuggerUrl?: string }>;
    const wsUrl = targets.find((t) => t.webSocketDebuggerUrl)?.webSocketDebuggerUrl;
    if (!wsUrl) throw new Error(`no webSocketDebuggerUrl at ${base}/json — is the app launched with --inspect?`);

    const inst = new MainInspector();
    inst.ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      inst.ws.onopen = () => resolve();
      inst.ws.onerror = () => reject(new Error(`could not connect to main-process inspector at ${wsUrl}`));
    });
    inst.ws.onmessage = (m: MessageEvent) => {
      const d = JSON.parse(typeof m.data === 'string' ? m.data : '{}') as { id?: number };
      if (d.id && inst.pending.has(d.id)) {
        inst.pending.get(d.id)!(d as { id: number; result?: unknown });
        inst.pending.delete(d.id);
      }
    };
    await inst.rawSend('Runtime.enable');
    log('info', `main-process inspector attached (${base})`);
    return inst;
  }

  private rawSend(method: string, params: Record<string, unknown> = {}): Promise<{ result?: unknown }> {
    return new Promise((resolve) => {
      const id = ++this.nextId;
      this.pending.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Evaluate an expression in the Electron main process and return its value by value. */
  async evaluate<T>(expression: string): Promise<T> {
    const r = (await this.rawSend('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      includeCommandLineAPI: true,
    })) as { result?: { result?: { value?: T }; exceptionDetails?: { exception?: { description?: string }; text?: string } } };
    const ex = r.result?.exceptionDetails;
    if (ex) throw new Error('main eval failed: ' + (ex.exception?.description ?? ex.text ?? 'unknown'));
    return r.result?.result?.value as T;
  }

  async close(): Promise<void> {
    try { this.ws.close(); } catch { /* already closed */ }
  }
}
