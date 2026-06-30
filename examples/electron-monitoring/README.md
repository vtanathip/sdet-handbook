# electron-monitoring

A **client-performance sign-off + evidence tracer** for Electron apps. It drives a real Playwright
scenario (open → log in → click → interact) against your app, **captures everything every layer did**
— and traces each event back to the **app code that caused it** — then either:

- **without a baseline** → produces a single-run **evidence report** (what the app did + a freeze
  verdict), or
- **with a baseline** → compares this build against a previous one and produces a **performance
  sign-off**: a budget-gated scorecard of per-`(route × step)` regressions in **timing and freezing**,
  a route×metric / step×metric matrix, and a **differential flamegraph** of where CPU time moved.

It's the sign-off gate you run after functional regression passes, to answer one question:
**did the new build get slower or jankier than the last one — and where, and which code is to blame?**

---

## Table of contents

- [Install](#install)
- [The two ways to run it](#the-two-ways-to-run-it)
  - [Without a baseline (single-run evidence)](#a-without-a-baseline--single-run-evidence)
  - [With a baseline (build-vs-build sign-off)](#b-with-a-baseline--build-vs-build-sign-off)
- [Pointing it at your app](#pointing-it-at-your-app)
  - [Source mode](#source-mode-harness-launches-the-app)
  - [Attach mode (packaged build)](#attach-mode-attach-to-a-packaged-build)
- [Writing a scenario](#writing-a-scenario)
- [What it captures (and how it's traced)](#what-it-captures-and-how-its-traced)
- [The reports](#the-reports)
- [The performance gate](#the-performance-gate)
- [Command reference](#command-reference)
- [Configuration (env vars)](#configuration-env-vars)
- [Run artifacts](#run-artifacts)
- [CI integration](#ci-integration)
- [Limits & caveats](#limits--caveats)

---

## Install

```bash
npm install          # also downloads the Electron binary (electron postinstall)
npm run selfcheck    # 8 pure self-checks, no Electron — sanity-checks the logic
npm test             # launches the bundled demo app, runs the scenario, writes a report
```

`npm run selfcheck` should print 8 green checks (`heartbeat`, `eventloop`, `correlator`, `report`,
`sourcemap`, `compare`, `ipc-renderer-tap`, `storage-tap`). If those pass, the install is good.

---

## The two ways to run it

A **run** = one execution of the scenario against one build. It writes a timestamped directory under
`runs/<timestamp>/` containing every evidence stream plus a report. You can consume a run two ways.

### A. Without a baseline — single-run evidence

Run the scenario once and read the report. You get the full per-layer evidence (every IPC message,
storage write, network call, etc., each traced to the code that issued it) plus a freeze verdict
(PASS / CAUTION / FAIL on perception-anchored thresholds — a freeze ≥3s is a FAIL).

```bash
npm test                                  # source mode, against the bundled demo app
open runs/<timestamp>/report.html         # the evidence dashboard
```

Use this when you want to **see what one build does** — debug a freeze, inspect IPC/storage/network
traffic, find who wrote a localStorage key. No second build needed.

### B. With a baseline — build-vs-build sign-off

This is the sign-off gate. Run the **same scenario** against the **old build** and the **new build**,
then diff them. Two ways to do the diff:

**1) Dedicated `compare` command** (recommended for ad-hoc two-build diffs):

```bash
# 1. record the OLD build's run
LAUNCH_MODE=... npm test        # → runs/<A>/   (the previous version)
# 2. record the NEW build's run
LAUNCH_MODE=... npm test        # → runs/<B>/   (the candidate version)
# 3. diff them
npm run compare -- runs/<A> runs/<B>
#    → prints the scorecard, writes runs/<B>/compare-report.{md,html} + compare-result.json
#    → exits 0 PASS / 1 CAUTION / 2 FAIL
```

**2) Saved baseline embedded in the run's own report** (recommended for CI):

```bash
# record the old build ONCE as the golden baseline
npm run baseline                          # → writes ./build-baseline.json from this run
# later, every new-build run auto-compares against it and embeds the diff in its report
BASELINE_FILE=./build-baseline.json npm test
#    the run's report gains a "Build comparison" section and the verdict folds in the regression
```

Use this when you want to **gate a release** on "no client-perf regression vs the last shipped build."

> The comparison joins the two runs **by scenario step name**, so both runs must execute the same
> scenario. Routes are keyed by SPA hash / page basename, so they match across builds even though the
> install path differs.

---

## Pointing it at your app

Set the target with env vars. Two launch modes:

### Source mode (harness launches the app)

Best for development and CI where you have the app source. The harness launches Electron, so it has
full main-process access (all layers, IPC main tap, child-process tracking).

```bash
ELECTRON_APP_PATH=/path/to/your/app npm test     # defaults to ./demo-app
```

### Attach mode (attach to a packaged build)

The primary flow for monitoring a **real packaged build**. The build must be launched with the two
debug flags so the harness can attach to the renderer (CDP) and the main process (Node inspector).
`attach.ts` does this for you:

```bash
npm run attach -- /path/to/YourApp.app/Contents/MacOS/YourApp
# launches the build with --remote-debugging-port + --inspect, waits for both endpoints,
# runs the scenario against it, writes the run dir, then kills the build.

# ports/timeout are overridable:
CDP_PORT=9222 INSPECT_PORT=9229 npm run attach -- ./dist/YourApp
```

Or wire it yourself by pointing at already-running endpoints:

```bash
LAUNCH_MODE=cdp \
ELECTRON_CDP_ENDPOINT=http://127.0.0.1:9222 \
ELECTRON_INSPECT_ENDPOINT=http://127.0.0.1:9229 \
npm test
```

> **`--inspect` matters.** With it, the main-process tap captures IPC across all windows and unlocks
> the main-loop / hardware / native / subprocess layers. **Without** a main channel (plain CDP), the
> harness falls back to a renderer-side `ipcRenderer` tap — which still captures IPC *and* the app
> call-site, but only if `ipcRenderer` is reachable in the page (see [Limits](#limits--caveats)).

---

## Writing a scenario

A scenario is a Playwright spec that drives your app through named **steps**. The step name is the
join key for the build comparison, so keep names stable across builds. See [tests/](tests/) for the
demo. The shape:

```ts
import { test } from './fixtures';

test('checkout flow', async ({ app }) => {
  const { window: page, step } = app;

  await step('login', async () => {
    await page.fill('[data-testid=email]', 'user@example.com');
    await page.click('[data-testid=signin]');
    await page.waitForSelector('[data-testid=dashboard]');
  });

  await step('open orders', async () => {
    await page.click('nav >> text=Orders');
    await page.waitForSelector('.orders-grid');
  });

  await step('filter + scroll', async () => {
    await page.fill('[data-testid=filter]', 'pending');
    await page.mouse.wheel(0, 4000);
  });
});
```

Each `step()` records its `[start, end]` window; every captured event in that window is attributed to
the step (and the active route). The same spec runs against both builds — only the launch target
changes between the old-build run and the new-build run.

---

## What it captures (and how it's traced)

Every layer streams **all** of its signal (not just threshold breaches) to its own file, and ties each
event to the **app code / service** responsible — the traceability is the point.

| Layer | What it captures | Traced to | Stream |
|-------|------------------|-----------|--------|
| **IPC** | every message both directions, transport, byte size, arg types, preview, invoke round-trip latency | the **app call-site** that issued the channel | `ipc.jsonl`, `ipc-callsites.jsonl` |
| **Storage** | every `localStorage`/`sessionStorage` `set`/`remove`/`clear` + key, size, preview, + a final snapshot | the **call-site** that wrote each key | `storage-ops.jsonl` |
| **Network** | every request: timing, status, size, type | the CDP **initiator** (call-site) | `network.jsonl` |
| **Renderer UI** | jank gaps ≥50ms, per route | the route (and the long-task script) | `heartbeat.jsonl` |
| **Long tasks** | long tasks + LoAF script attribution | `sourceURL` / `functionName` | `renderer-tasks.jsonl` |
| **Main loop** | event-loop lag + every `ipcMain` handler timing | the **blocking handler** name | `main-loop.jsonl` |
| **JS errors** | uncaught exceptions / rejections / console errors | the **stack** / top frame | `js-errors.jsonl` |
| **Memory** | per-process CPU/mem; renderer **JS heap** per route | the process / route | `metrics.jsonl`, `heap.jsonl` |
| **Host** | host CPU/load/free-mem over the run + box identity | **app-vs-host** CPU attribution (confounder check) | `host.jsonl` |
| **Routes** | every navigation (the route timeline) | — | `routes.jsonl` |
| **Breadcrumbs** | the app's own console output | `file:line` of the call | `breadcrumbs.jsonl` |
| **Subprocess** | `child_process` spawn/exit/hang (cdp+inspect only) | argv + stderr tail | `subprocess.jsonl` |
| **Freezes** | threshold-crossing freeze events, all layers | the primary layer's cause | `freezes.jsonl` |
| **Deep** | whole-run CDP trace with V8 CPU samples | — | `trace.json` |

No app cooperation is required for any of this — the harness instruments the platform primitives
(`ipcMain`/`ipcRenderer`, `Storage.prototype`, CDP Network, `PerformanceObserver`, …) itself.

---

## The reports

**Single-run report** — `runs/<ts>/report.html` (+ `electron-freeze-report-<ts>.md`):
- A verdict banner + per-step timeline lanes.
- **Evidence by layer** panels showing the real captured data with call-sites — top IPC channels
  ("called by"), storage writes ("written by"), slowest network ("started by"), main-loop handler
  timings, CPU/mem peaks, JS errors, host CPU with app-vs-host split.
- A freeze drill-down (ranked incidents, "🔎 Start here", "where to look next").

**Comparison report** — `runs/<ts>/compare-report.html` (+ `.md`), written by `npm run compare`:
- **Scorecard** — the gate: every regressed metric, old → new → Δ vs budget, worst-first.
- **By route** and **By step** matrices — which screen / which interaction regressed.
- **Hot-path diff** — a differential flamegraph from the `trace.json` CPU samples: which functions
  burn more CPU in the new build (red = slower).

**Inline baseline diff** — when `BASELINE_FILE` is set instead, the run's own `report.html` gains a
lighter *"Build comparison — timing & freeze diff"* section: a per-step table of old → new duration Δ
plus freeze regressions, and the verdict folds it in. (No per-metric scorecard, route matrix, or
flamegraph — use `compare` for those.)

---

## The performance gate

The sign-off gates on **Electron client-perf metrics**, each with a budget (allowed regression before
it trips). Computed per step and per route:

| Metric | Default budget |
|--------|----------------|
| Step duration | +20% |
| UI gap p95 (responsiveness) | +25% |
| Main-loop lag p95 | +25% |
| IPC message volume | +30% |
| Invoke round-trip p95 | +25% |
| Peak JS heap | +20% |

A metric over budget → **CAUTION**; a **doubled** metric, or a **new-or-worsened freeze that reaches
≥3s** → **FAIL**. Override all per-metric budgets with `PERF_BUDGET_PCT`. (`BASELINE_TOLERANCE` tunes
the separate `BASELINE_FILE` in-report diff, *not* these `compare` budgets — whose freeze-worsening
factor is a fixed `1.2×`.)

Verdict → exit code: **PASS = 0 · CAUTION = 1 · FAIL = 2**.

---

## Command reference

| Command | What it does |
|---------|--------------|
| `npm test` | Run the scenario against the target, write a run + report. |
| `npm run baseline` | Run the scenario and save it as `./build-baseline.json` (the golden build). |
| `npm run compare -- <oldRun> <newRun> [outDir]` | Diff two run dirs → perf sign-off report + exit code. |
| `npm run attach -- <binary> [app args]` | Launch a packaged build with debug flags and run the scenario against it. |
| `npm run signoff` | Run the suite and exit with the verdict code (for CI). |
| `npm run watch` | Interactive: drive the app by hand, reproduce a freeze, get a report on Ctrl-C. |
| `npm run selfcheck` | 8 pure logic self-checks (no Electron). |
| `npm run typecheck` | `tsc --noEmit`. |

---

## Configuration (env vars)

**Target / mode**
- `LAUNCH_MODE` — `source` (default) or `cdp` (attach).
- `ELECTRON_APP_PATH` — app to launch in source mode (default `./demo-app`).
- `ELECTRON_CDP_ENDPOINT` / `ELECTRON_INSPECT_ENDPOINT` — renderer / main endpoints in cdp mode.
- `CDP_PORT` / `INSPECT_PORT` / `ATTACH_TIMEOUT_MS` — used by `npm run attach`.

**Baseline / gate**
- `SAVE_BASELINE` — path to write this run's baseline (the `baseline` script sets `./build-baseline.json`).
- `BASELINE_FILE` — baseline to compare against; embeds the inline diff in the run's report + folds the verdict.
- `BASELINE_TOLERANCE` — tolerance for the `BASELINE_FILE` inline diff (default `1.2` = +20%). Does **not** affect the `compare` budgets.
- `PERF_BUDGET_PCT` — override all per-metric budgets in the `compare` gate with one percentage.

**Capture**
- `CAPTURE_ALL=0` — disable the continuous streams (keep only threshold-based freeze events).
- `PREVIEW_CHARS` — cap on captured IPC/storage value previews (default `200`).
- `STREAM_MAX_EVENTS` — per-stream ceiling (default `100000`); excess is dropped + logged.
- `RECORD_VIDEO=1` — record the renderer (off by default; can jam CDP in headless envs).

**Thresholds** (perception-anchored defaults; rarely need changing): `FREEZE_THRESHOLD_MS` (200),
`MAIN_LOOP_MAX_MS` (200), `METRICS_INTERVAL_MS` (250), `IPC_STORM_MSGS` (1000), `STALL_MS` (5000),
`STORAGE_PCT` (0.8), `DISK_LOW_BYTES`, `IO_SLOW_MS` (750), `SUBPROCESS_HUNG_MS` (10000),
`DEEP_EVIDENCE_MIN_MS` (3000).

---

## Run artifacts

Each `runs/<timestamp>/` contains:

```text
report.html / electron-freeze-report-*.md   single-run evidence report
compare-report.html / .md                    build comparison (when compare runs)
result.json / compare-result.json            { verdict, exitCode } for CI
meta.json                                     run + build identity + host info

# evidence streams (one per layer)
ipc.jsonl  ipc-callsites.jsonl               every IPC message + app call-sites
storage.jsonl  storage-ops.jsonl             quota/disk + localStorage/sessionStorage writes
network.jsonl  heartbeat.jsonl  main-loop.jsonl
metrics.jsonl  heap.jsonl  host.jsonl        per-process + JS heap + host metrics
routes.jsonl  breadcrumbs.jsonl  js-errors.jsonl
renderer-tasks.jsonl  subprocess.jsonl  freezes.jsonl  actions.jsonl
trace.json                                   CDP trace w/ CPU samples (feeds the flamegraph)
```

`runs/` is git-ignored. Open the `.html` reports in a browser; load `trace.json` in
`chrome://tracing`, Perfetto, or DevTools → Performance for the raw call stacks.

---

## CI integration

`npm run signoff` runs the suite and exits with the verdict code. Gate a release with the baseline:

```bash
# nightly: refresh the golden baseline from the last shipped build
npm run baseline

# per-PR: build the candidate, run against the baseline, fail on regression
BASELINE_FILE=./build-baseline.json npm run signoff
# exit 0 PASS · 1 CAUTION · 2 FAIL
```

Or run `compare` between two explicit build runs and key CI off `compare-result.json`.

---

## Limits & caveats

- **IPC app call-site needs a reachable `ipcRenderer`.** The renderer-side tap captures the call-site
  only when `ipcRenderer` is reachable in the page world (`nodeIntegration`, or an exposed
  `window.require`). A hardened **`contextIsolation`** app hides it — you still get every IPC message
  via the main-process tap (with `--inspect`), just without the renderer call-site. Storage call-sites
  are unaffected (they use a main-world API).
- **Attach needs the debug flags.** A packaged build must be launched with `--remote-debugging-port`
  and `--inspect`; production builds that disable the Node inspector can't be attached. `attach.ts`
  fails loudly with guidance if an endpoint never comes up.
- **The differential flamegraph is best on a real app.** On the near-idle demo it's dominated by the
  measurement apparatus (Playwright/our probes), which is filtered out — leaving little signal. On a
  real app under a real version bump, app frames dominate.
- **Per-route breakdown needs a multi-route app.** A single-page app collapses to one route row;
  the route dimension pays off on apps with multiple screens.
- **Streams are capped.** `STREAM_MAX_EVENTS` bounds each file; overflow is dropped and logged (never
  silently truncated). Raise it for a deep-capture run.

---

## How it works

The harness wires a `Monitor` of per-layer detectors over a Playwright `Page` (+ a `MainBridge` into
the Electron main process in source / inspect mode). Each detector instruments a platform primitive,
streams its evidence to a JSONL file, and emits threshold-crossing events onto a shared bus. At
teardown the reporter reduces the streams to per-step / per-route metrics, correlates events to steps
and call-sites, computes the verdict, and renders the reports. The build comparison
([src/compare.ts](src/compare.ts)) diffs two runs' reduced metrics against budgets; the flamegraph
([src/flamegraph.ts](src/flamegraph.ts)) folds and diffs the `trace.json` CPU samples. See
[docs/how-it-works.md](docs/how-it-works.md) for the deeper tour.
