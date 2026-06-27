const { contextBridge, ipcRenderer } = require('electron');

// Only the triggers that need the main process go through IPC. Pure renderer freezes
// (busy-loop, mem-balloon, gpu-stall, no-freeze) run directly in index.html.
contextBridge.exposeInMainWorld('freeze', {
  mainBusy: (ms) => ipcRenderer.invoke('main-busy', ms),
  syncDeadlock: (ms) => ipcRenderer.sendSync('sync-deadlock', ms),
  crash: () => ipcRenderer.send('crash'),
  // Fire-and-forget fetch that never resolves — a background spinner, not a thread block.
  stallFetch: () => { fetch('hang://stall/never').catch(() => {}); },
  // IPC flush issues: flood main with N sends (the loop runs in the renderer process, so it also
  // briefly blocks the renderer), and a jumbo invoke payload that blocks both sides on clone.
  ipcFlood: (n) => { for (let i = 0; i < n; i++) ipcRenderer.send('em-ipc-noop', i); },
  // An object array (not a typed array) is expensive to structured-clone, so the invoke blocks the
  // renderer while serializing and main while deserializing.
  ipcJumbo: (n) => ipcRenderer.invoke('em-ipc-echo',
    Array.from({ length: n }, (_, i) => ({ i, name: 'item-' + i, payload: 'xxxxxxxxxxxxxxxx' }))),
});
