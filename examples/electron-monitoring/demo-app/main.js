// Freeze-trigger demo app — the Electron analog of process-watchdog's Freeze4s VBA macros.
// Each renderer button intentionally hangs some part of the stack so the harness can prove
// every detection layer fires. DO NOT copy these patterns into a real app.
const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const path = require('node:path');

// A custom protocol whose handler never resolves — a fetch to it hangs in-flight forever (the
// "spinner that never resolves" case). Must be registered before app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'hang', privileges: { standard: true, supportFetchAPI: true, corsEnabled: true } },
]);

function busyLoop(ms) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    /* spin the calling thread — this is the freeze */
  }
}

// Main-process busy loop: stalls the Node event loop (L3) + pins main CPU (L4).
ipcMain.handle('main-busy', (_e, ms) => {
  busyLoop(ms);
  return 'done';
});

// Synchronous IPC into a busy handler: blocks BOTH the renderer thread (it waits for the
// reply) and the main thread (it's spinning) — L1 + L3. Self-releases so tests recover.
ipcMain.on('sync-deadlock', (e, ms) => {
  busyLoop(ms);
  e.returnValue = 'released';
});

// Hard renderer crash → app 'render-process-gone' (L5).
ipcMain.on('crash', (e) => {
  e.sender.forcefullyCrashRenderer();
});

// Hard MAIN-process crash → the whole app dies; only the harness-side watcher can report it.
ipcMain.on('crash-main', () => { process.crash(); });

// IPC flood target: a cheap handler hit thousands of times saturates the main event loop (L3/L7).
let ipcHits = 0;
ipcMain.on('em-ipc-noop', () => { ipcHits++; });

// Jumbo IPC payload: deserializing a large structured clone blocks the main thread (L3); the
// renderer blocked while serializing it (L1).
ipcMain.handle('em-ipc-echo', (_e, data) => (data ? data.length : 0));

// Spawn an external child process. require() at call time so the monitor's child_process patch is in
// effect. 'hang' lingers (flagged hung); 'crash' exits non-zero (flagged crashed).
ipcMain.handle('spawn-child', (_e, kind) => {
  const cp = require('node:child_process');
  const isWin = process.platform === 'win32';
  const c = kind === 'crash'
    ? (isWin ? cp.spawn('cmd', ['/c', 'exit 7']) : cp.spawn('sh', ['-c', 'exit 7']))
    : (isWin ? cp.spawn('cmd', ['/c', 'timeout 30']) : cp.spawn('sh', ['-c', 'sleep 30']));
  return c.pid;
});

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Keep renderer timers accurate even when the window isn't focused, so idle periods don't
      // look like freezes to the heartbeat detector.
      backgroundThrottling: false,
    },
  });
  win.loadFile('index.html');
}

app.whenReady().then(() => {
  protocol.handle('hang', () => new Promise(() => {})); // never resolves → request stays in-flight
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
