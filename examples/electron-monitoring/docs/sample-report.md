# Electron Freeze Watchdog — Sign-off Report

| Field | Value |
|-------|-------|
| Date | 2026-06-27 |
| Session | 17:14:08 → 17:15:20 (1m 12s) |
| App | ./demo-app |
| Launch Mode | source |
| Main-process layers | available |
| Freeze Threshold | 200ms |
| **Verdict** | **❌ FAIL** |

## Freezes at a glance

| # | When | Triggered by | What froze | Duration | Severity |
|---|------|--------------|-----------|----------|----------|
| 1 | 17:14:08 | click Freeze 4s | Long JavaScript task | 4.0s | SEVERE |
| 2 | 17:14:13 | click Freeze 2s | Long JavaScript task | 2.0s | MODERATE |
| 3 | 17:14:16 | click Main busy 3s | Main process blocked | 3.0s | MODERATE |
| 4 | 17:14:23 | click Sync deadlock | Main process blocked | 3.1s | SEVERE |
| 5 | 17:14:27 | click IPC flood | IPC flood | 0.3s | MODERATE |
| 6 | 17:14:30 | click IPC jumbo | Main process blocked | 0.7s | MODERATE |
| 7 | 17:14:36 | click GPU stall | Long JavaScript task | 1.2s | MODERATE |
| 8 | 17:14:42 | click Crash renderer | Unresponsive / crash | 0.0s | SEVERE |

## Diagnosis

### #1 · Long JavaScript task · 4.0s (SEVERE)

- **Triggered by:** click Freeze 4s
- **Where (root cause):** file:///Users/vtanathip/Repository/sdet-handbook/examples/electron-monitoring/demo-app/index.html → (anonymous) (offset 2261)
- **What happened:** A single JavaScript task ran far past one frame, blocking input and rendering.
- **CPU:** peak 6.9% on the Tab process — getAppMetrics CPU% is coarse; use trace.json for the real hot path
- **Next step:** Optimize or split the function shown below; defer non-urgent work (requestIdleCallback / setTimeout / batching).
- **Signals:** UI thread froze: UI thread unresponsive for 4004ms; Long JavaScript task: blocked 3950ms — file:///Users/vtanathip/Repository/sdet-handbook/examples/electron-monitoring/demo-app/index.html → (anonymous) (offset 2261, 3999ms); Long JavaScript task: blocked 4000ms (longtask)

### #2 · Long JavaScript task · 2.0s (MODERATE)

- **Triggered by:** click Freeze 2s
- **Where (root cause):** file:///Users/vtanathip/Repository/sdet-handbook/examples/electron-monitoring/demo-app/index.html → (anonymous) (offset 2261)
- **What happened:** A single JavaScript task ran far past one frame, blocking input and rendering.
- **CPU:** peak 6.9% on the Tab process — getAppMetrics CPU% is coarse; use trace.json for the real hot path
- **Next step:** Optimize or split the function shown below; defer non-urgent work (requestIdleCallback / setTimeout / batching).
- **Signals:** Long JavaScript task: blocked 1949ms — file:///Users/vtanathip/Repository/sdet-handbook/examples/electron-monitoring/demo-app/index.html → (anonymous) (offset 2261, 1999ms); UI thread froze: UI thread unresponsive for 2002ms; Long JavaScript task: blocked 1999ms (longtask)

### #3 · Main process blocked · 3.0s (MODERATE)

- **Triggered by:** click Main busy 3s
- **Where (root cause):** main event loop stalled 2985ms
- **What happened:** The Electron main (Node) event loop stalled — this freezes every window and all IPC at once.
- **CPU:** peak 3.9% on the Browser process — getAppMetrics CPU% is coarse; use trace.json for the real hot path
- **Next step:** Remove synchronous work from the main process: no blocking I/O or heavy compute in IPC handlers; avoid sendSync into slow handlers.
- **Signals:** Main process blocked: main event loop stalled 2985ms

### #4 · Main process blocked · 3.1s (SEVERE)

- **Triggered by:** click Sync deadlock
- **Where (root cause):** file:///Users/vtanathip/Repository/sdet-handbook/examples/electron-monitoring/demo-app/index.html → (anonymous) (offset 2261)
- **What happened:** The Electron main (Node) event loop stalled — this freezes every window and all IPC at once.
- **CPU:** peak 5.3% on the Browser process — getAppMetrics CPU% is coarse; use trace.json for the real hot path
- **Next step:** Remove synchronous work from the main process: no blocking I/O or heavy compute in IPC handlers; avoid sendSync into slow handlers.
- **Signals:** Long JavaScript task: blocked 2950ms — file:///Users/vtanathip/Repository/sdet-handbook/examples/electron-monitoring/demo-app/index.html → (anonymous) (offset 2261, 2999ms); UI thread froze: UI thread unresponsive for 3002ms; Long JavaScript task: blocked 3000ms (longtask); Main process blocked: main event loop stalled 2968ms

### #5 · IPC flood · 0.3s (MODERATE)

- **Triggered by:** click IPC flood
- **Where (root cause):** 50000 IPC messages in one interval (~200000/s)
- **What happened:** The renderer sent IPC messages faster than the main process could drain them (backpressure) — the queue could not flush.
- **CPU:** peak 9.2% on the Browser process — getAppMetrics CPU% is coarse; use trace.json for the real hot path
- **Next step:** Batch or throttle ipcRenderer.send; coalesce per-event chatter into fewer, larger messages.
- **Signals:** IPC flood: 50000 IPC messages in one interval (~200000/s)

### #6 · Main process blocked · 0.7s (MODERATE)

- **Triggered by:** click IPC jumbo
- **Where (root cause):** file:///Users/vtanathip/Repository/sdet-handbook/examples/electron-monitoring/demo-app/index.html → (anonymous) (offset 2261)
- **What happened:** The Electron main (Node) event loop stalled — this freezes every window and all IPC at once.
- **CPU:** peak 10.3% on the Tab process — getAppMetrics CPU% is coarse; use trace.json for the real hot path
- **Next step:** Remove synchronous work from the main process: no blocking I/O or heavy compute in IPC handlers; avoid sendSync into slow handlers.
- **Signals:** Long JavaScript task: blocked 271ms — file:///Users/vtanathip/Repository/sdet-handbook/examples/electron-monitoring/demo-app/index.html → (anonymous) (offset 2261, 320ms); Long JavaScript task: blocked 321ms (longtask); UI thread froze: UI thread unresponsive for 323ms; Main process blocked: main event loop stalled 361ms; Resource pressure: memory grew 2.15× (now 842 MB)

### #7 · Long JavaScript task · 1.2s (MODERATE)

- **Triggered by:** click GPU stall
- **Where (root cause):** file:///Users/vtanathip/Repository/sdet-handbook/examples/electron-monitoring/demo-app/index.html → (anonymous) (offset 2261)
- **What happened:** A single JavaScript task ran far past one frame, blocking input and rendering.
- **CPU:** peak 5.7% on the Tab process — getAppMetrics CPU% is coarse; use trace.json for the real hot path
- **Next step:** Optimize or split the function shown below; defer non-urgent work (requestIdleCallback / setTimeout / batching).
- **Signals:** UI thread froze: UI thread unresponsive for 1210ms; Long JavaScript task: blocked 1157ms — file:///Users/vtanathip/Repository/sdet-handbook/examples/electron-monitoring/demo-app/index.html → (anonymous) (offset 2261, 1207ms); Long JavaScript task: blocked 1207ms (longtask)

### #8 · Unresponsive / crash · 0.0s (SEVERE)

- **Triggered by:** click Crash renderer
- **Where (root cause):** render-process-gone — reason: killed (exit 2)
- **What happened:** Chromium flagged the window unresponsive, or a process crashed.
- **CPU:** peak 2% on the Utility process — getAppMetrics CPU% is coarse; use trace.json for the real hot path
- **Next step:** Check the crash reason below and correlate with the freeze immediately before it.
- **Signals:** Unresponsive / crash: render-process-gone — reason: killed (exit 2)

## Summary

- **Freezes:** 8 · **worst:** 4.0s · **total frozen:** 14.3s · **average:** 1.8s
- **Signals seen:** UI thread froze (5), Long JavaScript task (10), Main process blocked (3), IPC flood (1), Resource pressure (1), Unresponsive / crash (1)

## Sign-off Criteria

| Criterion | Threshold | Result |
|-----------|-----------|--------|
| No freezes | 0 | ❌ 8 |
| Longest freeze < 3s | < 3s | ❌ 4.004s |
| Total freeze time < 10s | < 10s | ❌ 14.260s |

## Artifacts

- `report.html` — visual report (open in a browser)
- `trace.json` — Chromium trace with CPU samples → load in `chrome://tracing`, Perfetto, or DevTools → Performance (import). The exact hung call stack is here, at the freeze timestamps above.
- Raw evidence: `freezes.jsonl`, `metrics.jsonl`, `actions.jsonl`, `renderer-tasks.jsonl`, `ipc.jsonl`

---
*Generated by electron-monitoring on 2026-06-27 10:14:08*
