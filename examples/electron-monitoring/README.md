# electron-monitoring

Playwright-driven freeze detection for Electron apps. Runs scenarios against an Electron app,
watches **six layers** of the Chromium/Node stack at once, correlates every freeze to the **UI
action that triggered it**, and produces a **Markdown sign-off report + a visual HTML timeline**.

It's the Electron sibling of [`process-watchdog`](../process-watchdog) (which does the same for
Excel via Win32 `SendMessageTimeout`). Same verdict contract (PASS / CAUTION / FAIL + CI exit codes),
different target.

## Why

An Electron app can freeze for very different reasons, and a single probe can't tell them apart:

| Layer | Module | What it catches | API |
|-------|--------|-----------------|-----|
| L1 renderer heartbeat | [rendererHeartbeat.ts](src/detectors/rendererHeartbeat.ts) | renderer **UI thread** blocked (busy JS) | injected rAF + `setInterval` gap |
| L2 task attribution | [rendererTasks.ts](src/detectors/rendererTasks.ts) | **which script** blocked, to file:line | `PerformanceObserver` `longtask` + `long-animation-frame` (LoAF) |
| L3 main-loop lag | [mainLoopLag.ts](src/detectors/mainLoopLag.ts) | **main process** event loop stalled (stalls all windows/IPC) | main-process timer lateness |
| L4 hardware | [appMetrics.ts](src/detectors/appMetrics.ts) | per-process **CPU / memory / GPU** | `app.getAppMetrics()` |
| L5 native | [nativeSignals.ts](src/detectors/nativeSignals.ts) | Chromium **unresponsive** / renderer **crash** | `webContents` events, `render-process-gone` |
| L7 IPC flush | [ipcFlood.ts](src/detectors/ipcFlood.ts) | **IPC flood / backpressure** (renderer→main `send` storm that won't drain) | `ipcMain.emit` counter |
| L6 deep evidence | [deepEvidence.ts](src/detectors/deepEvidence.ts) | the **hung call stack** | CDP `Tracing` → `trace.json` (with embedded CPU samples) |

Each detector emits onto a shared bus; the reporter merges overlapping detections into freeze
*incidents*, attributes each to the in-flight `step()`, and renders the report.

## Quick start

```bash
npm install                   # also downloads the Electron binary (electron postinstall)
npm run selfcheck             # 4 pure self-checks (no Electron) — heartbeat, eventloop, correlator, report
npm test                      # launches the demo app, runs the freeze sweep, writes the report
```

Open the report:

```bash
open runs/<timestamp>/report.html                   # visual timeline (which click froze)
cat  runs/<timestamp>/electron-freeze-report-*.md   # CI sign-off
# trace.json → load in chrome://tracing, Perfetto, or DevTools → Performance (import);
#   it embeds CPU samples, so the hung call stack is in there.
```

See a captured example: [docs/sample-report.md](docs/sample-report.md) (and the
[HTML timeline](docs/sample-report.html) — artifact links there are per-run, not bundled).

For a CI gate that exits with the verdict code (0 PASS / 1 CAUTION / 2 FAIL):

```bash
npm run signoff
```

## The demo app

[demo-app/](demo-app/) is a tiny Electron app with one button per freeze type (the analog of
process-watchdog's `Freeze4s` VBA macros). **Don't copy these patterns into production** — they
intentionally hang.

| Button | Freeze | Layers | Verdict |
|--------|--------|--------|---------|
| Renderer block 4s | 4s renderer busy-loop | L1, L2, L6 | FAIL |
| Renderer block 2s | 2s renderer busy-loop | L1, L2 | CAUTION |
| Main busy 3s | IPC → main busy-loop | L3, L4 | FAIL |
| Sync-IPC deadlock | `sendSync` into a blocked handler | L1, L3 | FAIL |
| IPC flood | 50k `send` in a burst (queue can't flush) | L7 (+L1/L3 if heavy) | FAIL |
| IPC jumbo payload | `invoke` a 1.5M-object structured clone | L1, L3 | CAUTION |
| Memory balloon | ~720MB of arrays | L4 | CAUTION |
| GPU / paint stall | heavy synchronous canvas | L2, L4 | CAUTION |
| Crash renderer | `forcefullyCrashRenderer()` | L5 | FAIL |
| No freeze | append 1000 rows | — | PASS |

## Point it at your real app

Everything is config-driven (see [src/config.ts](src/config.ts)); defaults target the demo.

```bash
# From source (full 6-layer coverage):
ELECTRON_APP_PATH=/path/to/your/app npm test

# Packaged binary — launch it yourself with BOTH ports, then attach:
#   YourApp.exe --remote-debugging-port=9222 --inspect=9229
LAUNCH_MODE=cdp \
  ELECTRON_CDP_ENDPOINT=http://127.0.0.1:9222 \
  ELECTRON_INSPECT_ENDPOINT=http://127.0.0.1:9229 \
  npm test
```

**Two ports, all layers.** The renderer is Chromium (`--remote-debugging-port`); the main process is
Node (`--inspect`). With **both**, the harness attaches a CDP session to the renderer *and* a
Node-inspector session to the main process, so **all seven layers work on a packaged app**.

If you give only `--remote-debugging-port` (no `--inspect`), the main-process layers (L3/L4/L5/L7) are
dark — the report marks them *unavailable (plain cdp — add --inspect)*. Running **from source** also
gives all layers.

> `--inspect` is respected by packaged apps unless the `EnableNodeCliInspectArguments` Electron fuse
> was disabled. If `http://127.0.0.1:9229/json` is empty, the build has it off — use source mode, or
> have the app open a debug port itself.

**Env knobs:** `RECORD_VIDEO=1` adds a `video.webm` (off by default — `recordVideo` can jam Electron's
CDP pipe in headless/displayless environments); `FREEZE_THRESHOLD_MS`, `MAIN_LOOP_MAX_MS`,
`METRICS_INTERVAL_MS`, `DEEP_EVIDENCE_MIN_MS`, `IPC_STORM_MSGS` tune detection. The harness auto-strips
`ELECTRON_RUN_AS_NODE` before launching (set by some Electron-based IDEs/CI runners; left in place it
makes Electron run as plain Node and reject Chromium flags).

Write your own scenarios by copying [tests/freeze.demo.spec.ts](tests/freeze.demo.spec.ts) and wrapping
each interaction in `step('name', () => …)` so freezes get attributed to it.

See [docs/how-it-works.md](docs/how-it-works.md) for the per-layer mechanics, thresholds, and caveats.
