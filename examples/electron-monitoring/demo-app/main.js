// Freeze-trigger demo app — the Electron analog of process-watchdog's Freeze4s VBA macros.
// Each renderer button intentionally hangs some part of the stack so the harness can prove
// every detection layer fires. DO NOT copy these patterns into a real app.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

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

// IPC flood target: a cheap handler hit thousands of times saturates the main event loop (L3/L7).
let ipcHits = 0;
ipcMain.on('em-ipc-noop', () => { ipcHits++; });

// Jumbo IPC payload: deserializing a large structured clone blocks the main thread (L3); the
// renderer blocked while serializing it (L1).
ipcMain.handle('em-ipc-echo', (_e, data) => (data ? data.length : 0));

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
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
