const { contextBridge, ipcRenderer } = require('electron');

// Only the triggers that need the main process go through IPC. Pure renderer freezes
// (busy-loop, mem-balloon, gpu-stall, no-freeze) run directly in index.html.
contextBridge.exposeInMainWorld('freeze', {
  mainBusy: (ms) => ipcRenderer.invoke('main-busy', ms),
  syncDeadlock: (ms) => ipcRenderer.sendSync('sync-deadlock', ms),
  crash: () => ipcRenderer.send('crash'),
});
