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
no single equivalent, so this harness runs **a dozen probes at once** and lets the report tell them apart.

## Architecture

```
playwright test
  └─ tests/fixtures.ts  (per spec)
       ├─ launch Electron  (electron.launch)  OR  connectOverCDP (packaged)
       ├─ page = electronApp.firstWindow()
       ├─ Monitor.start()  → all detectors, each polling every 250ms, all pushing onto FreezeBus
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

| Layer | API | Signal → names | Default threshold |
|-------|-----|----------------|-------------------|
| **L1** renderer heartbeat | injected `requestAnimationFrame` + `setInterval(50ms)` ticker recording the largest gap between its own ticks | gap > threshold = UI thread blocked → **which route** + core count | `200ms` (`FREEZE_THRESHOLD_MS`) |
| **L2** task attribution | `PerformanceObserver` on `longtask` (≥50ms) and `long-animation-frame` (LoAF: phase timestamps + `scripts[]` → `invoker`, `invokerType`, `forcedStyleAndLayoutDuration`, `pauseDuration`) | task ≥ threshold → the **call-site** (`BUTTON#save.onclick`), **script-vs-layout split**, thrash/sync-block hints, all scripts | `200ms` to flag |
| **L3** main-loop lag | a `setInterval(50ms)` timer measures how late it fires vs schedule; **every `ipcMain.on`/`handle` is wrapped + timed** so a lag spike is matched to the handler that ran during it | `max lag > 200ms` → names the **ipcMain handler** that blocked it (or "no handler → compute/GC/sync-IO") | `MAIN_LOOP_MAX_MS` |
| **L4** hardware | `app.getAppMetrics()` per-process `cpu.percentCPUUsage`, `memory.workingSetSize`/`peakWorkingSetSize`, `idleWakeupsPerSecond`, `name`, streamed to `metrics.jsonl` (our own L6 Tracing Service is excluded from findings) | sustained CPU >90% for >2s, or per-process memory growth >2.0 → the **specific process + pid** (incl. which utility) | `cpuPctThreshold`, `memGrowthRatio` |
| **L5** native | `webContents` `unresponsive`/`responsive` (with `wc.id`/url/title), `app` `render-process-gone`/`child-process-gone` (with details) | unresponsive→responsive bracket; crash = SEVERE → the **window** (title+url) or **child process** + reason | Chromium-internal (~tens of s) |
| **L7** IPC flush | `ipcMain.emit` **and** `ipcMain.handle` patched to count renderer→main traffic **per channel** (send + invoke); polled + reset each interval | messages/interval ≥ threshold → the **flooding channel** + its % share | `IPC_STORM_MSGS` (1000) |
| **L6** deep evidence | CDP `Tracing` for the whole run, with category `disabled-by-default-v8.cpu_profiler` so the trace embeds CPU samples → `trace.json` (Node-side buffer capped at 300k events) | always captured | — |

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

[report.ts](../src/report.ts) merges overlapping detector events into freeze **incidents** (one click
that trips L1 *and* L2 is one row, not two), **ranks** them by confidence, and writes a report that
leads with the likely bug instead of dumping everything flat:

- **`electron-freeze-report-*.md`**
  - **🔎 Start here** — the single highest impact × confidence incident, with its root cause + where to look next.
  - **Freezes by priority** — ranked, with a **confidence** column (corroboration across layers × tied to an action × has a named cause).
  - **Diagnosis** per incident: root cause sourced from the *primary* layer (so a main-process freeze names **its handler**, not a renderer char-offset — the old `culprit()` bug), **Where to look next** (exact artifact + filter), signals, breadcrumbs.
  - **Likely noise** — low-confidence idle blips, demoted so they don't bury the real bug.
  - **Sign-off criteria** that mirror what *actually* gates (no display-only rows that could disagree with the exit code).
- **`report.html`** — the same as a time-axis timeline (UI actions vs freeze bars), with a Start-here banner and confidence/baseline chips per card.
- **`layers/<layer>.md`** — a per-layer drill-down for each layer that fired, with a pointer to its raw JSONL stream.
- **`result.json`** — `{verdict, exitCode}` for `npm run signoff`.

### Verdict — perception-anchored, or baseline-relative

The thresholds come from two principled places, never thin air:

- **Perception anchors (default).** `200ms` = a freeze, `≥3s` = SEVERE → FAIL — grounded in HCI research
  (Nielsen 0.1 / 1 / 10s, Google RAIL, Web Vitals INP). These gate when there's no baseline.
- **Baseline (app-relative).** For "how slow is too slow for *this* app" there's no universal number, so
  record a known-good run (`SAVE_BASELINE`) and a later run gates on **regression** (`BASELINE_FILE`):
  each freeze is tagged `within` (expected → demoted), `new` (a layer the green run never had), or
  `worse` (past `BASELINE_TOLERANCE`, default 1.2×). A crash is always a regression.

| Condition | Verdict | Exit |
|-----------|---------|------|
| no freeze (or all within baseline) | PASS | 0 |
| a freeze, none ≥3s, no crash (or a non-severe regression) | CAUTION | 1 |
| any freeze ≥3s, a crash, or a severe regression | FAIL | 2 |

Playwright's own exit code only reflects test errors, so [src/signoff.ts](../src/signoff.ts) runs the
suite and then exits with the verdict code for CI gating.

### Measurement overhead (observer effect)

Measuring perturbs the app, but bounded: renderer-compute overhead is below the noise floor, IPC
round-trips are ~+8µs each (only matters under a flood), and L6's whole-run CDP `Tracing` is the one
real cost — tens of MB in the harness + ~120MB in Chromium's separate **Tracing Service** process
(excluded from L4 findings so the instrument never measures itself). Freeze *timing* (L1/L3) is
unaffected — separate processes, no thread blocking. Run `npx tsx scripts/bench-overhead.ts` to
measure it on your machine.

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
