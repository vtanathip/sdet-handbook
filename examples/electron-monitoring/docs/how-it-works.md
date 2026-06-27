# How it works

## The problem

A frozen Electron window has many possible causes, and they need different fixes:

- the **renderer** main thread is busy running JavaScript (a tight loop, a huge synchronous layout);
- the **main** process (Node) event loop is blocked (a synchronous IPC handler, blocking I/O, heavy
  compute), which stalls *every* window and all IPC;
- the **GPU** process is wedged, so nothing composites even though JS is fine;
- the app is leaking memory until it thrashes;
- a renderer **crashed**.

`process-watchdog` answers this for Excel with one Win32 probe (`SendMessageTimeout`). Electron has
no single equivalent, so this harness runs **six probes at once** and lets the report tell them apart.

## Architecture

```
playwright test
  └─ tests/fixtures.ts  (per spec)
       ├─ launch Electron  (electron.launch)  OR  connectOverCDP (packaged)
       ├─ page = electronApp.firstWindow()
       ├─ Monitor.start()  → 6 detectors, each polling every 250ms, all pushing onto FreezeBus
       │     L1 rendererHeartbeat   L2 rendererTasks    L6 deepEvidence    (renderer / CDP)
       │     L3 mainLoopLag         L4 appMetrics       L5 nativeSignals   (main process)
       ├─ step('click X', …)  → records [start,end] to actions.jsonl
       └─ teardown: Monitor.stop() flushes JSONL + trace.json; save video (if RECORD_VIDEO=1)
  └─ tests/global-teardown.ts
       └─ buildReport(runDir)  → correlate freezes↔actions, merge incidents, verdict
                               → electron-freeze-report-*.md + report.html + result.json
```

Every detector emits a normalized `FreezeEvent` (`{layer, startIso, durationMs, severity, detail}`)
onto the in-process `FreezeBus`. The monitor appends each to `freezes.jsonl`. The reporter reads the
JSONL back, so report generation is fully decoupled and unit-testable (see the `report` self-check).

## The layers in detail

| Layer | API | Signal | Default threshold |
|-------|-----|--------|-------------------|
| **L1** renderer heartbeat | injected `requestAnimationFrame` + `setInterval(50ms)` ticker recording the largest gap between its own ticks | gap > threshold = UI thread was blocked | `200ms` (`FREEZE_THRESHOLD_MS`) |
| **L2** task attribution | `PerformanceObserver` on `longtask` (≥50ms) and `long-animation-frame` (LoAF: `blockingDuration` + `scripts[]` → `sourceURL`, function, char position) | task ≥ threshold; all ≥50ms logged to `renderer-tasks.jsonl` | `200ms` to flag |
| **L3** main-loop lag | a `setInterval(50ms)` timer in the main process measures how late it fires vs schedule (the lateness = time the loop was blocked), polled + reset each interval | `max lag > 200ms` | `MAIN_LOOP_MAX_MS` |
| **L4** hardware | `app.getAppMetrics()` per-process `cpu.percentCPUUsage` + `memory.workingSetSize`, streamed to `metrics.jsonl` | sustained CPU > 90% for >2s, or memory growth ratio > 2.0 | `cpuPctThreshold`, `memGrowthRatio` |
| **L5** native | `webContents` `unresponsive`/`responsive`, `app` `render-process-gone`/`child-process-gone` | unresponsive→responsive bracket; crash = SEVERE | Chromium-internal (~tens of s) |
| **L7** IPC flush | `ipcMain.emit` is patched in the main process to count renderer→main `send` traffic; polled + reset each interval | messages/interval ≥ threshold = an IPC storm the queue can't flush | `IPC_STORM_MSGS` (1000) |
| **L6** deep evidence | CDP `Tracing` for the whole run, with category `disabled-by-default-v8.cpu_profiler` so the trace embeds CPU samples → `trace.json` | always captured | — |

### Why the heartbeat reads the gap *after* recovery

While the renderer thread is blocked, a `page.evaluate` can't run — so the poll that reads the
heartbeat is itself queued behind the freeze. That's fine: the in-page ticker records the largest gap
between its own ticks, and the poll reads that value once the thread frees. We never rely on a probe
succeeding *during* the hang. The same is true for L3 (the main-process timer can't fire while the
loop is blocked, so it records the lag on its first tick after recovery). The CDP `Tracing` (L6) runs
for the whole run, so the hang — and the CPU samples taken across it — land in `trace.json` regardless.

## Freeze → action correlation

`step(name, fn)` ([tests/fixtures.ts](../tests/fixtures.ts)) records the in-flight action window to
`actions.jsonl`. At report time [correlator.ts](../src/correlator.ts) interval-joins each freeze's
start timestamp against those windows (±300ms tolerance), so the report names *which click froze it*.
For renderer-blocking actions the Playwright `click()` itself doesn't resolve until the thread frees,
so the window naturally spans the freeze; for async triggers (main busy-loop, memory) the scenario
holds the step open with an explicit wait.

## The report

[report.ts](../src/report.ts) merges overlapping detector events into freeze **incidents** (so one
click that trips L1 *and* L2 is one row, not two), pulls **peak CPU** for each incident from
`metrics.jsonl`, and writes:

- **`electron-freeze-report-*.md`** — sign-off table, freeze events (`# | Start | Duration | Peak CPU |
  Triggering Action | Layer(s) | Severity`), summary, sign-off criteria — mirroring
  `process-watchdog/ProcessWatchdog/ReportWriter.cs`.
- **`report.html`** — a time-axis timeline: UI actions on one track, freezes (red bars) on the track
  below, aligned so the eye lands on the action that froze. Each incident expands to its layers and
  the LoAF script attribution.
- **`result.json`** — `{verdict, exitCode}` for `npm run signoff`.

### Verdict (matches process-watchdog)

| Condition | Verdict | Exit |
|-----------|---------|------|
| no freeze incidents | PASS | 0 |
| any incident, none ≥ 3s and no crash | CAUTION | 1 |
| any incident ≥ 3s, or a crash | FAIL | 2 |

Playwright's own exit code only reflects test errors, so [src/signoff.ts](../src/signoff.ts) runs the
suite and then exits with the verdict code for CI gating.

## Launch modes

The renderer and the main process speak **different debug protocols**, so the harness reaches them
through a `MainBridge` abstraction with two implementations:

- **source** (`electron.launch({ args: [appPath] })`) — Playwright owns the app; the bridge is
  `ElectronAppBridge` (uses `electronApp.evaluate`). **All seven layers.** Use for the demo and any
  app you can run from source.
- **cdp** (`chromium.connectOverCDP`) — for a packaged binary. The renderer is reached over the
  Chromium `--remote-debugging-port`; that alone gives the renderer layers (L1/L2/L6). To get the
  main-process layers (L3/L4/L5/L7) you **also** launch the app with `--inspect=<port>` and set
  `ELECTRON_INSPECT_ENDPOINT` — the bridge becomes `InspectorBridge`, attaching a Node-inspector
  client to the main process (it reaches `require('electron')` via the inspector's command-line API).
  Without `--inspect`, the main-process layers are marked unavailable in the report.

The detectors are channel-agnostic: they call `MainBridge` methods, and each bridge phrases the same
probe for its channel (Playwright's `evaluate(fn)` with the electron module as arg, vs. the
inspector's `Runtime.evaluate(expr)` with `require`).

## Caveats

- **Playwright Electron support is experimental** — pin the Playwright version; `electronApp.evaluate`
  and the Electron entry points are the parts most likely to shift between releases.
- **LoAF requires Chromium ≥123 (Electron ≥30).** On older Electron, L2 degrades to `longtask` only
  and the report shows *LoAF attribution: unavailable*.
- **Windows vs macOS:** `memory.workingSetSize` is the private working set on Windows and resident
  memory on macOS, so L4 gates on a growth *ratio*, never absolute MB. The GPU process may run
  in-process on macOS under some flags. The verdict gates on freeze *timing*, not memory.
- **Some CDP/recording surfaces hang on Electron here.** Playwright's `context.tracing.start()` and
  the CDP `Profiler` domain both hang on the Electron target, and `recordVideo` can jam the CDP pipe
  in a headless/displayless environment — so this harness uses CDP `Tracing` only (verified working),
  makes video opt-in (`RECORD_VIDEO=1`), and wraps L6 in timeouts so deep evidence can never hang the
  run. `electronApp.evaluate` exposes the electron module as its first argument (there is no `require`
  in that scope), which is why L3 measures event-loop lag with a plain timer rather than
  `perf_hooks.monitorEventLoopDelay`.
- The demo's `sync-deadlock` handler self-releases after a few seconds so tests always recover — a
  real `sendSync` into a never-returning handler wedges the app permanently.
- After a renderer **crash**, detector polls against the dead renderer can't resolve; `Monitor.stop()`
  races each detector's teardown against a timeout, so a crash run ends in seconds-not-forever.

## References

- Playwright Electron — https://playwright.dev/docs/api/class-electron , https://playwright.dev/docs/api/class-electronapplication
- Electron `app.getAppMetrics` / process-gone events — https://www.electronjs.org/docs/latest/api/app
- Electron `webContents` unresponsive — https://www.electronjs.org/docs/latest/api/web-contents
- Node `perf_hooks.monitorEventLoopDelay` — https://nodejs.org/api/perf_hooks.html
- Long Animation Frames (LoAF) — https://developer.chrome.com/docs/web-platform/long-animation-frames
- Long Tasks API — https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongTaskTiming
- Sibling: `examples/process-watchdog/docs/how-it-works.md` (the Win32 / Excel original)
