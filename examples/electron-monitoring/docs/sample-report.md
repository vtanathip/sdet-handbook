# Electron Freeze Watchdog — Sign-off Report

| Field | Value |
|-------|-------|
| Date | 2026-06-27 |
| Session | 22:37:20 → 22:38:50 (1m 30s) |
| App | ./demo-app |
| Launch Mode | source |
| Main-process layers | available |
| Freeze Threshold | 200ms |
| **Verdict** | **❌ FAIL** |

## Freezes at a glance

| # | When | Triggered by | What froze | Duration | Severity |
|---|------|--------------|-----------|----------|----------|
| 1 | 22:37:20 | click Stuck request | Stuck operation (spinner) | 7.1s | SEVERE |
| 2 | 22:37:20 | click Freeze 4s | Long JavaScript task | 4.0s | SEVERE |
| 3 | 22:37:25 | click Freeze 2s | Long JavaScript task | 2.0s | MODERATE |
| 4 | 22:37:28 | click Main busy 3s | Main process blocked | 3.0s | MODERATE |
| 5 | 22:37:35 | click Sync deadlock | Main process blocked | 3.2s | SEVERE |
| 6 | 22:37:39 | click IPC flood | IPC flood | 0.5s | MODERATE |
| 7 | 22:37:42 | click IPC jumbo | Main process blocked | 0.9s | MODERATE |
| 8 | 22:37:49 | click GPU stall | Long JavaScript task | 1.2s | MODERATE |
| 9 | 22:37:52 | click JS error | JavaScript error | 0.0s | MODERATE |
| 10 | 22:37:55 | click Crash renderer | Unresponsive / crash | 0.0s | SEVERE |
| 11 | 22:38:41 | click Crash MAIN process | Unresponsive / crash | 0.0s | SEVERE |

## Diagnosis

### #1 · Stuck operation (spinner) · 7.1s (SEVERE)

- **Triggered by:** click Stuck request
- **Where (root cause):** request stuck 7s — hang://stall/never
- **What happened:** An async operation never completed while the app kept running and CPU stayed idle — the classic “spinner that never resolves”: a hung request, an IPC reply that never came, or a stuck page load.
- **CPU:** peak 6.9% on the Tab process — getAppMetrics CPU% is coarse; use trace.json for the real hot path
- **Next step:** Add a timeout / AbortController to the request or IPC call below; make sure every handler eventually resolves or rejects.
- **Signals:** Stuck operation (spinner): request stuck 7s — hang://stall/never
- **App logged just before:**
  - `22:37:20` [log] [api] GET /reports/quarterly — awaiting response…
  - `22:37:20` [log] [orders] rendering 4000 line items for invoice #4821

### #2 · Long JavaScript task · 4.0s (SEVERE)

- **Triggered by:** click Freeze 4s
- **Where (root cause):** file:///Users/vtanathip/Repository/sdet-handbook/examples/electron-monitoring/demo-app/index.html → (anonymous) (offset 3516)
- **What happened:** A single JavaScript task ran far past one frame, blocking input and rendering.
- **CPU:** peak 6.9% on the Tab process — getAppMetrics CPU% is coarse; use trace.json for the real hot path
- **Next step:** Optimize or split the function shown below; defer non-urgent work (requestIdleCallback / setTimeout / batching).
- **Signals:** Long JavaScript task: blocked 3950ms — file:///Users/vtanathip/Repository/sdet-handbook/examples/electron-monitoring/demo-app/index.html → (anonymous) (offset 3516, 3999ms); UI thread froze: UI thread unresponsive for 4002ms; Long JavaScript task: blocked 4000ms (longtask)
- **App logged just before:**
  - `22:37:20` [log] [orders] rendering 4000 line items for invoice #4821

### #3 · Long JavaScript task · 2.0s (MODERATE)

- **Triggered by:** click Freeze 2s
- **Where (root cause):** file:///Users/vtanathip/Repository/sdet-handbook/examples/electron-monitoring/demo-app/index.html → (anonymous) (offset 3516)
- **What happened:** A single JavaScript task ran far past one frame, blocking input and rendering.
- **CPU:** peak 6.8% on the Tab process — getAppMetrics CPU% is coarse; use trace.json for the real hot path
- **Next step:** Optimize or split the function shown below; defer non-urgent work (requestIdleCallback / setTimeout / batching).
- **Signals:** UI thread froze: UI thread unresponsive for 2002ms; Long JavaScript task: blocked 1950ms — file:///Users/vtanathip/Repository/sdet-handbook/examples/electron-monitoring/demo-app/index.html → (anonymous) (offset 3516, 1999ms); Long JavaScript task: blocked 2000ms (longtask)

### #4 · Main process blocked · 3.0s (MODERATE)

- **Triggered by:** click Main busy 3s
- **Where (root cause):** main event loop stalled 2961ms
- **What happened:** The Electron main (Node) event loop stalled — this freezes every window and all IPC at once.
- **CPU:** peak 5.9% on the Browser process — getAppMetrics CPU% is coarse; use trace.json for the real hot path
- **Next step:** Remove synchronous work from the main process: no blocking I/O or heavy compute in IPC handlers; avoid sendSync into slow handlers.
- **Signals:** Main process blocked: main event loop stalled 2961ms
- **App logged just before:**
  - `22:37:28` [info] [ledger] reconciling 12k transactions with server…

### #5 · Main process blocked · 3.2s (SEVERE)

- **Triggered by:** click Sync deadlock
- **Where (root cause):** file:///Users/vtanathip/Repository/sdet-handbook/examples/electron-monitoring/demo-app/index.html → (anonymous) (offset 3516)
- **What happened:** The Electron main (Node) event loop stalled — this freezes every window and all IPC at once.
- **CPU:** peak 0.7% on the Browser process — getAppMetrics CPU% is coarse; use trace.json for the real hot path
- **Next step:** Remove synchronous work from the main process: no blocking I/O or heavy compute in IPC handlers; avoid sendSync into slow handlers.
- **Signals:** Long JavaScript task: blocked 2949ms — file:///Users/vtanathip/Repository/sdet-handbook/examples/electron-monitoring/demo-app/index.html → (anonymous) (offset 3516, 2999ms); UI thread froze: UI thread unresponsive for 3001ms; Long JavaScript task: blocked 2999ms (longtask); Main process blocked: main event loop stalled 2981ms

### #6 · IPC flood · 0.5s (MODERATE)

- **Triggered by:** click IPC flood
- **Where (root cause):** 43363 IPC messages in one interval (~173452/s)
- **What happened:** The renderer sent IPC messages faster than the main process could drain them (backpressure) — the queue could not flush.
- **CPU:** peak 8.5% on the Browser process — getAppMetrics CPU% is coarse; use trace.json for the real hot path
- **Next step:** Batch or throttle ipcRenderer.send; coalesce per-event chatter into fewer, larger messages.
- **Signals:** IPC flood: 43363 IPC messages in one interval (~173452/s); IPC flood: 6637 IPC messages in one interval (~26548/s)

### #7 · Main process blocked · 0.9s (MODERATE)

- **Triggered by:** click IPC jumbo
- **Where (root cause):** file:///Users/vtanathip/Repository/sdet-handbook/examples/electron-monitoring/demo-app/index.html → (anonymous) (offset 3516)
- **What happened:** The Electron main (Node) event loop stalled — this freezes every window and all IPC at once.
- **CPU:** peak 10.3% on the Tab process — getAppMetrics CPU% is coarse; use trace.json for the real hot path
- **Next step:** Remove synchronous work from the main process: no blocking I/O or heavy compute in IPC handlers; avoid sendSync into slow handlers.
- **Signals:** Long JavaScript task: blocked 284ms — file:///Users/vtanathip/Repository/sdet-handbook/examples/electron-monitoring/demo-app/index.html → (anonymous) (offset 3516, 333ms); Long JavaScript task: blocked 334ms (longtask); UI thread froze: UI thread unresponsive for 336ms; Main process blocked: main event loop stalled 319ms; Resource pressure: memory grew 2.17× (now 848 MB)

### #8 · Long JavaScript task · 1.2s (MODERATE)

- **Triggered by:** click GPU stall
- **Where (root cause):** file:///Users/vtanathip/Repository/sdet-handbook/examples/electron-monitoring/demo-app/index.html → (anonymous) (offset 3516)
- **What happened:** A single JavaScript task ran far past one frame, blocking input and rendering.
- **CPU:** peak 5.6% on the Tab process — getAppMetrics CPU% is coarse; use trace.json for the real hot path
- **Next step:** Optimize or split the function shown below; defer non-urgent work (requestIdleCallback / setTimeout / batching).
- **Signals:** UI thread froze: UI thread unresponsive for 1204ms; Long JavaScript task: blocked 1152ms — file:///Users/vtanathip/Repository/sdet-handbook/examples/electron-monitoring/demo-app/index.html → (anonymous) (offset 3516, 1202ms); Long JavaScript task: blocked 1202ms (longtask)

### #9 · JavaScript error · 0.0s (MODERATE)

- **Triggered by:** click JS error
- **Where (root cause):** console.error [renderer]: demo console error
- **What happened:** Code threw an uncaught exception / unhandled rejection (or logged an error). The app may be in a broken state even though it did not freeze or crash.
- **CPU:** peak 0.7% on the Browser process — getAppMetrics CPU% is coarse; use trace.json for the real hot path
- **Next step:** Read the message + stack below and fix the throw. A preload throw means your exposed API never loaded — check the preload and contextBridge wiring.
- **Signals:** JavaScript error: console.error [renderer]: demo console error; JavaScript error: uncaught-exception [renderer]: demo uncaught exception
- **App logged just before:**
  - `22:37:52` [error] demo console error

### #10 · Unresponsive / crash · 0.0s (SEVERE)

- **Triggered by:** click Crash renderer
- **Where (root cause):** render-process-gone — reason: killed (exit 2)
- **What happened:** Chromium flagged the window unresponsive, or a process crashed.
- **CPU:** peak 4.3% on the Utility process — getAppMetrics CPU% is coarse; use trace.json for the real hot path
- **Next step:** Check the crash reason below and correlate with the freeze immediately before it.
- **Signals:** Unresponsive / crash: render-process-gone — reason: killed (exit 2)

### #11 · Unresponsive / crash · 0.0s (SEVERE)

- **Triggered by:** click Crash MAIN process
- **Where (root cause):** MAIN process exited unexpectedly (code null, SIGSEGV) — the whole app went down
- **What happened:** Chromium flagged the window unresponsive, or a process crashed.
- **CPU:** near 0% (a blocked process often can’t be sampled mid-freeze — treat as approximate) — getAppMetrics CPU% is coarse; use trace.json for the real hot path
- **Next step:** Check the crash reason below and correlate with the freeze immediately before it.
- **Signals:** Unresponsive / crash: MAIN process exited unexpectedly (code null, SIGSEGV) — the whole app went down

## Summary

- **Freezes:** 11 · **worst:** 7.1s · **total frozen:** 22.0s · **average:** 2.0s
- **Signals seen:** UI thread froze (5), Long JavaScript task (10), Main process blocked (3), IPC flood (2), Resource pressure (1), JavaScript error (2), Stuck operation (spinner) (1), Unresponsive / crash (2)

## Sign-off Criteria

| Criterion | Threshold | Result |
|-----------|-----------|--------|
| No freezes | 0 | ❌ 11 |
| Longest freeze < 3s | < 3s | ❌ 7.131s |
| Total freeze time < 10s | < 10s | ❌ 21.978s |

## Artifacts

- `report.html` — visual report (open in a browser)
- `trace.json` — Chromium trace with CPU samples → load in `chrome://tracing`, Perfetto, or DevTools → Performance (import). The exact hung call stack is here, at the freeze timestamps above.
- Raw evidence: `freezes.jsonl`, `metrics.jsonl`, `actions.jsonl`, `renderer-tasks.jsonl`, `ipc.jsonl`, `breadcrumbs.jsonl` (the app’s own log lines)

---
*Generated by electron-monitoring on 2026-06-27 15:37:20*
