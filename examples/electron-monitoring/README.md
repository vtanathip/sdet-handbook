# electron-monitoring

Playwright-driven freeze detection for Electron apps. Runs scenarios against an Electron app,
watches **every layer** of the Chromium/Node stack at once, **names the root cause** of each freeze
(the blocking IPC handler, the script call-site, the flooding channel…), correlates it to the **UI
action that triggered it**, **ranks** freezes by confidence, and produces a **Markdown sign-off
report + a visual HTML timeline**. Gate on perception-anchored thresholds, or record a **baseline**
and gate on *regression vs a known-good run*.

It's the Electron sibling of [`process-watchdog`](../process-watchdog) (which does the same for
Excel via Win32 `SendMessageTimeout`). Same verdict contract (PASS / CAUTION / FAIL + CI exit codes),
different target.

## Why

An Electron app can freeze for very different reasons, and a single probe can't tell them apart:

Each layer doesn't just *detect* a freeze — it **names the root cause** so you know where to look:

| Layer | Module | What it catches → and names | API |
|-------|--------|-----------------------------|-----|
| L1 renderer heartbeat | [rendererHeartbeat.ts](src/detectors/rendererHeartbeat.ts) | renderer **UI thread** blocked → how long + **which route** + core count | injected rAF + `setInterval` gap |
| L2 task attribution | [rendererTasks.ts](src/detectors/rendererTasks.ts) | **which call-site** blocked (`BUTTON#save.onclick`) + **script-vs-layout** split + thrash/sync-block hints | `PerformanceObserver` `longtask` + `long-animation-frame` (LoAF) |
| L3 main-loop lag | [mainLoopLag.ts](src/detectors/mainLoopLag.ts) | **main process** event loop stalled → names the **ipcMain handler** that blocked it (or "no handler → compute/GC/sync-IO") | main-process timer lateness + per-handler timing |
| L4 hardware | [appMetrics.ts](src/detectors/appMetrics.ts) | sustained CPU / memory balloon → the **specific process + pid** (incl. which utility, e.g. Network Service) | `app.getAppMetrics()` |
| L5 native | [nativeSignals.ts](src/detectors/nativeSignals.ts) | Chromium **unresponsive** / **crash** → the **window** (title+url) or **child process** + reason (oom/killed) | `webContents` events, `render-process-gone`, `child-process-gone` |
| L7 IPC flush | [ipcFlood.ts](src/detectors/ipcFlood.ts) | **IPC flood / backpressure** → the **flooding channel** + its % share (send **and** invoke) | `ipcMain.emit` + `handle`, per-channel counter |
| L8 stall | [stallWatch.ts](src/detectors/stallWatch.ts) | **stuck async op** (spinner) → the **initiator call-site** + failure reason (DNS/timeout/blocked) | CDP `Network` in-flight age + `initiator` |
| JS errors | [jsErrors.ts](src/detectors/jsErrors.ts) | uncaught / unhandledrejection / console → full **stack + file:line** top frame; preload-vs-renderer-vs-main | `pageerror`/`console` + main `uncaughtException` |
| Storage | [storageDisk.ts](src/detectors/storageDisk.ts) | storage quota / disk-low / slow-disk → which **storage system** + origin + volume path | `storage.estimate()` + `statfs` + I/O canary |
| Subprocess | [subprocess.ts](src/detectors/subprocess.ts) | `child_process` spawn that **hangs or crashes** → argv + **stderr tail** (the actual error) | child_process patch (cdp+inspect only) |
| Main death | [mainDeath.ts](src/mainDeath.ts) | the **whole app dies** (uncaught main exception, OOM, SIGKILL) | `electronApp.process` exit (source mode) |
| L6 deep evidence | [deepEvidence.ts](src/detectors/deepEvidence.ts) | the **hung call stack** | CDP `Tracing` → `trace.json` (with embedded CPU samples) |
| Breadcrumbs | [breadcrumbs.ts](src/detectors/breadcrumbs.ts) | **app-domain context** — the app's own log lines, shown "just before" each freeze | `page.on('console')`, all levels → `breadcrumbs.jsonl` |

Each detector emits onto a shared bus; the reporter merges overlapping detections into freeze
*incidents*, attributes each to the in-flight `step()`, **ranks them by confidence** (how many layers
agree × tied to an action × named cause), leads with a **🔎 Start here** pick, demotes low-confidence
blips to a **Likely noise** bucket, and writes a **per-layer drill-down report** for each layer that
fired. See [the report section](#the-report--what-it-tells-you) below.

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

## The report — what it tells you

The report leads with what matters and ranks the rest, so the real bug isn't buried in noise:

- **🔎 Start here** — the single most likely bug (highest impact × confidence), with its root cause and where to look next.
- **Freezes by priority** — a ranked table with a **confidence** column (how many independent layers agree × tied to a click × has a named cause), not a chronological dump.
- **Diagnosis** — per incident: root cause, what happened, **Where to look next** (the exact artifact + filter to open), corroborating signals, and the app's breadcrumbs.
- **Likely noise** — low-confidence single-layer idle blips, demoted so they don't bury the real bug.
- **`layers/<layer>.md`** — a per-layer drill-down for each layer that fired; **`report.html`** — the visual timeline; **`result.json`** — `{verdict, exitCode}` for CI.

### Verdict & thresholds — where the numbers come from

Two kinds of threshold, by where their number legitimately comes from:

- **Perception-anchored (default).** `200ms` = a freeze, `≥3s` = SEVERE/FAIL — grounded in HCI research (Nielsen 0.1/1/10s, Google RAIL, Web Vitals INP), *not* arbitrary. These ship as defaults and gate when there's no baseline.
- **App-relative (baseline).** "How slow is too slow for *this* app" has no universal value — record a baseline and gate on **regression vs your known-good run** (next section).

| Condition | Verdict | Exit |
|-----------|---------|------|
| no freeze (or all within baseline) | PASS | 0 |
| a freeze, none ≥3s, no crash (or a non-severe regression) | CAUTION | 1 |
| any freeze ≥3s, a crash, or a severe regression | FAIL | 2 |

## Baseline — gate on regression, not a magic number

A hardcoded "3s = fail" doesn't fit every app. Instead, record a **known-good ("green") run** and gate
future runs on whether they got **worse**:

```bash
# 1. Record a baseline from a green run → writes ./freeze-baseline.json
npm run baseline                       # = SAVE_BASELINE=./freeze-baseline.json playwright test

# 2. Gate future runs against it — only NEW or materially-WORSE freezes fail
BASELINE_FILE=./freeze-baseline.json npm test
BASELINE_FILE=./freeze-baseline.json npm run signoff   # CI

# tolerance: how much worse than green counts as a regression (default 1.2 = 20% worse)
BASELINE_FILE=./freeze-baseline.json BASELINE_TOLERANCE=1.5 npm test
```

With a baseline, freezes that match green are tagged **✓ within** and demoted; only **🔺 new** (a freeze
on a layer the green run never had) or **🔺 worse** (past the tolerance) count as regressions and gate
the verdict — a crash is always a regression. The report's **Gate** line shows which mode is active,
and each freeze carries its baseline tag.

> Record the baseline against a **representative, known-good** session on representative hardware (it
> stores per-layer worst-freeze durations from whatever run you point it at). `SAVE_BASELINE` /
> `BASELINE_FILE` are plain env vars — on Windows use `cross-env` or set them in your shell.

## Watch mode — reproduce a freeze by hand

When you don't have a scripted repro, attach the monitor and drive the app yourself:

```bash
npm run watch                                  # launches ./demo-app (or ELECTRON_APP_PATH)
# … the app opens; click around and reproduce the freeze …
# Ctrl+C  → writes the same report.html + .md
```

It keeps all detectors running the whole time, **captures your clicks** so each freeze is blamed on
the button you pressed, and writes the report on stop. Attach to a packaged build the same way
(`LAUNCH_MODE=cdp …`, plus `ELECTRON_INSPECT_ENDPOINT` for the main-process layers). Set
`WATCH_MAX_SECONDS=N` to auto-stop instead of Ctrl+C (useful in CI).

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
| Crash MAIN process | `process.crash()` in main | main-death | FAIL |
| Stuck request | `fetch('hang://…')` that never resolves | L8 | FAIL |
| Storage fill | write to Cache API | Storage* | CAUTION |
| JS error | uncaught exception + console.error | JS errors | (advisory) |
| Spawn child (hangs/crashes) | `child_process.spawn` sleep / exit 7 | Subprocess† | CAUTION/FAIL |
| No freeze | append 1000 rows | — | PASS |

\* Storage-pressure needs a real `http(s)`/custom-secure origin — Chromium reports 0 usage for `file://`, so the demo only exercises the sampler. † Subprocess tracking needs **cdp+inspect** (`require` isn't reachable in source-mode `evaluate`).

A few triggers also `console.log` a domain-style line first (e.g. *"rendering 4000 line items for invoice #4821"*); the report shows those **breadcrumbs "just before"** the freeze, so you see what the app thought it was doing when it hung — the app-domain context a probe can't infer. Point this at your real app and its own `console`/`electron-log` output flows in automatically.

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
`METRICS_INTERVAL_MS`, `DEEP_EVIDENCE_MIN_MS`, `IPC_STORM_MSGS`, `STALL_MS`, `STORAGE_PCT`,
`DISK_LOW_BYTES`, `IO_SLOW_MS`, `SUBPROCESS_HUNG_MS` tune detection. The harness auto-strips
`ELECTRON_RUN_AS_NODE` before launching (set by some Electron-based IDEs/CI runners; left in place it
makes Electron run as plain Node and reject Chromium flags).

Write your own scenarios by copying [tests/freeze.demo.spec.ts](tests/freeze.demo.spec.ts) and wrapping
each interaction in `step('name', () => …)` so freezes get attributed to it.

See [docs/how-it-works.md](docs/how-it-works.md) for the per-layer mechanics, thresholds, and caveats.
