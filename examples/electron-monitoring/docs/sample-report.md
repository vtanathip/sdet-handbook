# Electron Freeze Watchdog — Sign-off Report

| Field | Value |
|-------|-------|
| Date | 2026-06-27 |
| Session | 22:12:03 → 22:13:34 (1m 30s) |
| App | ./demo-app |
| Launch Mode | source |
| Main-process layers | available |
| Freeze Threshold | 200ms |
| **Verdict** | **❌ FAIL** |

## Freezes at a glance

| # | When | Triggered by | What froze | Duration | Severity |
|---|------|--------------|-----------|----------|----------|
| 1 | 22:12:04 | click Stuck request | Stuck operation (spinner) | 7.1s | SEVERE |
| 2 | 22:12:04 | click Freeze 4s | Long JavaScript task | 4.0s | SEVERE |
| 3 | 22:12:09 | click Freeze 2s | Long JavaScript task | 2.0s | MODERATE |
| 4 | 22:12:12 | click Main busy 3s | Main process blocked | 3.0s | MODERATE |
| 5 | 22:12:19 | click Sync deadlock | Main process blocked | 3.2s | SEVERE |
| 6 | 22:12:23 | click IPC flood | IPC flood | 0.5s | MODERATE |
| 7 | 22:12:26 | click IPC jumbo | Main process blocked | 0.9s | MODERATE |
| 8 | 22:12:33 | click GPU stall | Long JavaScript task | 1.2s | MODERATE |
| 9 | 22:12:35 | click JS error | JavaScript error | 0.0s | MODERATE |
| 10 | 22:12:39 | click Crash renderer | Unresponsive / crash | 0.0s | SEVERE |
| 11 | 22:13:26 | click Crash MAIN process | Unresponsive / crash | 0.0s | SEVERE |

## Diagnosis

### #1 · Stuck operation (spinner) · 7.1s (SEVERE)

- **Triggered by:** click Stuck request
- **Where (root cause):** request stuck 7s — hang://stall/never
- **What happened:** An async operation never completed while the app kept running and CPU stayed idle — the classic “spinner that never resolves”: a hung request, an IPC reply that never came, or a stuck page load.
- **CPU:** peak 6.9% on the Tab process — getAppMetrics CPU% is coarse; use trace.json for the real hot path
- **Next step:** Add a timeout / AbortController to the request or IPC call below; make sure every handler eventually resolves or rejects.
- **Signals:** Stuck operation (spinner): request stuck 7s — hang://stall/never

### #2 · Long JavaScript task · 4.0s (SEVERE)

- **Triggered by:** click Freeze 4s
- **Where (root cause):** file:///Users/vtanathip/Repository/sdet-handbook/examples/electron-monitoring/demo-app/index.html → (anonymous) (offset 2979)
- **What happened:** A single JavaScript task ran far past one frame, blocking input and rendering.
- **CPU:** peak 6.9% on the Tab process — getAppMetrics CPU% is coarse; use trace.json for the real hot path
- **Next step:** Optimize or split the function shown below; defer non-urgent work (requestIdleCallback / setTimeout / batching).
- **Signals:** Long JavaScript task: blocked 3950ms — file:///Users/vtanathip/Repository/sdet-handbook/examples/electron-monitoring/demo-app/index.html → (anonymous) (offset 2979, 3999ms); UI thread froze: UI thread unresponsive for 4002ms; Long JavaScript task: blocked 4000ms (longtask)

### #3 · Long JavaScript task · 2.0s (MODERATE)

- **Triggered by:** click Freeze 2s
- **Where (root cause):** file:///Users/vtanathip/Repository/sdet-handbook/examples/electron-monitoring/demo-app/index.html → (anonymous) (offset 2979)
- **What happened:** A single JavaScript task ran far past one frame, blocking input and rendering.
- **CPU:** peak 6.9% on the Tab process — getAppMetrics CPU% is coarse; use trace.json for the real hot path
- **Next step:** Optimize or split the function shown below; defer non-urgent work (requestIdleCallback / setTimeout / batching).
- **Signals:** Long JavaScript task: blocked 1950ms — file:///Users/vtanathip/Repository/sdet-handbook/examples/electron-monitoring/demo-app/index.html → (anonymous) (offset 2979, 1999ms); Long JavaScript task: blocked 2000ms (longtask); UI thread froze: UI thread unresponsive for 2001ms

### #4 · Main process blocked · 3.0s (MODERATE)

- **Triggered by:** click Main busy 3s
- **Where (root cause):** main event loop stalled 2969ms
- **What happened:** The Electron main (Node) event loop stalled — this freezes every window and all IPC at once.
- **CPU:** peak 0.6% on the Browser process — getAppMetrics CPU% is coarse; use trace.json for the real hot path
- **Next step:** Remove synchronous work from the main process: no blocking I/O or heavy compute in IPC handlers; avoid sendSync into slow handlers.
- **Signals:** Main process blocked: main event loop stalled 2969ms

### #5 · Main process blocked · 3.2s (SEVERE)

- **Triggered by:** click Sync deadlock
- **Where (root cause):** file:///Users/vtanathip/Repository/sdet-handbook/examples/electron-monitoring/demo-app/index.html → (anonymous) (offset 2979)
- **What happened:** The Electron main (Node) event loop stalled — this freezes every window and all IPC at once.
- **CPU:** peak 2% on the Browser process — getAppMetrics CPU% is coarse; use trace.json for the real hot path
- **Next step:** Remove synchronous work from the main process: no blocking I/O or heavy compute in IPC handlers; avoid sendSync into slow handlers.
- **Signals:** Long JavaScript task: blocked 2950ms — file:///Users/vtanathip/Repository/sdet-handbook/examples/electron-monitoring/demo-app/index.html → (anonymous) (offset 2979, 2999ms); UI thread froze: UI thread unresponsive for 3002ms; Long JavaScript task: blocked 3000ms (longtask); Main process blocked: main event loop stalled 2978ms

### #6 · IPC flood · 0.5s (MODERATE)

- **Triggered by:** click IPC flood
- **Where (root cause):** 29412 IPC messages in one interval (~117648/s)
- **What happened:** The renderer sent IPC messages faster than the main process could drain them (backpressure) — the queue could not flush.
- **CPU:** peak 7.1% on the Browser process — getAppMetrics CPU% is coarse; use trace.json for the real hot path
- **Next step:** Batch or throttle ipcRenderer.send; coalesce per-event chatter into fewer, larger messages.
- **Signals:** IPC flood: 29412 IPC messages in one interval (~117648/s); IPC flood: 20588 IPC messages in one interval (~82352/s)

### #7 · Main process blocked · 0.9s (MODERATE)

- **Triggered by:** click IPC jumbo
- **Where (root cause):** file:///Users/vtanathip/Repository/sdet-handbook/examples/electron-monitoring/demo-app/index.html → (anonymous) (offset 2979)
- **What happened:** The Electron main (Node) event loop stalled — this freezes every window and all IPC at once.
- **CPU:** peak 8.1% on the Tab process — getAppMetrics CPU% is coarse; use trace.json for the real hot path
- **Next step:** Remove synchronous work from the main process: no blocking I/O or heavy compute in IPC handlers; avoid sendSync into slow handlers.
- **Signals:** Long JavaScript task: blocked 285ms — file:///Users/vtanathip/Repository/sdet-handbook/examples/electron-monitoring/demo-app/index.html → (anonymous) (offset 2979, 334ms); Long JavaScript task: blocked 335ms (longtask); UI thread froze: UI thread unresponsive for 337ms; Main process blocked: main event loop stalled 333ms; Resource pressure: memory grew 2.18× (now 852 MB)

### #8 · Long JavaScript task · 1.2s (MODERATE)

- **Triggered by:** click GPU stall
- **Where (root cause):** file:///Users/vtanathip/Repository/sdet-handbook/examples/electron-monitoring/demo-app/index.html → (anonymous) (offset 2979)
- **What happened:** A single JavaScript task ran far past one frame, blocking input and rendering.
- **CPU:** peak 5.8% on the Tab process — getAppMetrics CPU% is coarse; use trace.json for the real hot path
- **Next step:** Optimize or split the function shown below; defer non-urgent work (requestIdleCallback / setTimeout / batching).
- **Signals:** UI thread froze: UI thread unresponsive for 1202ms; Long JavaScript task: blocked 1150ms — file:///Users/vtanathip/Repository/sdet-handbook/examples/electron-monitoring/demo-app/index.html → (anonymous) (offset 2979, 1199ms); Long JavaScript task: blocked 1200ms (longtask)

### #9 · JavaScript error · 0.0s (MODERATE)

- **Triggered by:** click JS error
- **Where (root cause):** console.error [renderer]: demo console error
- **What happened:** Code threw an uncaught exception / unhandled rejection (or logged an error). The app may be in a broken state even though it did not freeze or crash.
- **CPU:** peak 0.8% on the Browser process — getAppMetrics CPU% is coarse; use trace.json for the real hot path
- **Next step:** Read the message + stack below and fix the throw. A preload throw means your exposed API never loaded — check the preload and contextBridge wiring.
- **Signals:** JavaScript error: console.error [renderer]: demo console error; JavaScript error: uncaught-exception [renderer]: demo uncaught exception

### #10 · Unresponsive / crash · 0.0s (SEVERE)

- **Triggered by:** click Crash renderer
- **Where (root cause):** render-process-gone — reason: killed (exit 2)
- **What happened:** Chromium flagged the window unresponsive, or a process crashed.
- **CPU:** peak 3.2% on the Utility process — getAppMetrics CPU% is coarse; use trace.json for the real hot path
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

- **Freezes:** 11 · **worst:** 7.1s · **total frozen:** 21.9s · **average:** 2.0s
- **Signals seen:** UI thread froze (5), Long JavaScript task (10), Main process blocked (3), IPC flood (2), Resource pressure (1), JavaScript error (2), Stuck operation (spinner) (1), Unresponsive / crash (2)

## Sign-off Criteria

| Criterion | Threshold | Result |
|-----------|-----------|--------|
| No freezes | 0 | ❌ 11 |
| Longest freeze < 3s | < 3s | ❌ 7.148s |
| Total freeze time < 10s | < 10s | ❌ 21.883s |

## Artifacts

- `report.html` — visual report (open in a browser)
- `trace.json` — Chromium trace with CPU samples → load in `chrome://tracing`, Perfetto, or DevTools → Performance (import). The exact hung call stack is here, at the freeze timestamps above.
- Raw evidence: `freezes.jsonl`, `metrics.jsonl`, `actions.jsonl`, `renderer-tasks.jsonl`, `ipc.jsonl`

---
*Generated by electron-monitoring on 2026-06-27 15:12:03*
