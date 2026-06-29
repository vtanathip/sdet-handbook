# Evidence collection & freeze prevention

A technical briefing on the harness as an **evidence-collection system**: what the layer model
does well, the best practices for tracking/logging/collecting evidence on non-functional (freeze)
tests, a gap analysis against the state of the art, and a troubleshooting-to-prevent-freezes
playbook. Companion to [how-it-works.md](how-it-works.md).

> Sources below were web-researched and adversarially verified; a few claims that *failed*
> verification are called out inline so they don't get re-introduced.

## 1. What the layer model already does well

The harness is a **multi-witness evidence system**: 13 independent detectors observe the same freeze
from different vantage points and emit a uniform `FreezeEvent{layer,startIso,durationMs,severity,detail}`
onto one `FreezeBus`, which the `Monitor` tees verbatim into `freezes.jsonl`.

- **Corroboration across mechanically-independent layers.** A freeze is witnessed by layers that
  fail *differently* — L1 heartbeat (tick-gap), L2 LoAF (the blocking script), L3 main-loop lag (the
  process that freezes *all* windows), L5 Chromium `unresponsive` (the browser's own hang verdict),
  L7 IPC flood (the storm that drove it). Because they're independent, agreement is real signal, and
  the report's confidence score rewards exactly that (independent layers × tied-to-action × named-cause).
- **A whole-run trace that survives the hang** (L6). CDP Tracing runs for the entire session with
  `disabled-by-default-v8.cpu_profiler`, so sampled call stacks are already in the buffer at the
  freeze timestamp *before* detection fires — the correct answer to "a freeze is only detected on
  recovery." Same mechanism DevTools Performance / Perfetto use.
- **Recovery-safe probes.** L1/L3 read the *largest gap* after the thread frees; they never depend on
  a probe running *during* the hang (the probe that reads state can't run on the wedged thread).
- **Best-in-class renderer attribution** (L2 LoAF: blocking script + `work`/`render`/`styleLayout`
  phase split, `blockingDuration` as the promotion threshold) and **regression-vs-baseline gating**
  (the Lighthouse-CI pattern — "fast enough" is app/machine-relative) with perception-anchored
  fallbacks (200 ms freeze / 3 s SEVERE, defensible against RAIL / INP / Nielsen).

Honest summary: strengths cluster where the signal is **cheap and renderer-side**; gaps cluster
around **(a) the main process, (b) reading code locations through a bundle, (c) cross-stream
identity/clock, (d) crash-time durability.**

## 2. How to track, log & collect evidence (the model)

### Three evidence tiers
1. **Continuous metric streams** — cheap, always-on distributions: event-loop delay as a *histogram*
   (`perf_hooks.monitorEventLoopDelay`), loop saturation (`eventLoopUtilization` — reads ~1.0 even on
   a low-CPU *blocking syscall* that CPU% misses), per-process CPU/mem. → `metrics.jsonl`.
2. **Event / incident records** — discrete, structured, one record per line. → the JSONL backbone
   (`freezes.jsonl`, `js-errors.jsonl`, `ipc.jsonl`, …). The right shape.
3. **Deep artifacts** — expensive, captured around an incident: whole-run trace (`trace.json`),
   CPU profiles (`.cpuprofile`), heap snapshots (`.heapsnapshot`), process logs (`process.log`),
   video.

**Gate on `max`, not percentiles alone.** A wedged loop takes *no* sample while blocked, so a single
huge stall is one sample drowned by hundreds of idle ones — both a naive timer and a histogram
under-count long blocks ([nodejs/node#34661](https://github.com/nodejs/node/issues/34661)). This
validates the harness's existing "largest gap" choice.

### Correlation — IDs + clock alignment
Carry **one correlation key on every signal** so traces, logs, metrics and artifacts stitch into a
causal (not merely temporal) timeline. OpenTelemetry Context + Propagators are canonical; W3C
`traceparent` carries a 32-hex trace-id + 16-hex span-id across process boundaries
([W3C Trace Context](https://www.w3.org/TR/trace-context/),
[OTel context propagation](https://opentelemetry.io/docs/concepts/context-propagation/)). For this
harness the **renderer→main IPC boundary is the natural propagation point**: inject `traceparent`
into the `ipcRenderer.send` payload; continue the trace in the `ipcMain` handler. Structured logs
carry `trace_id`/`span_id` as top-level fields. Metrics tie to traces via **exemplars** (a sampled
trace-id on a datapoint), *not* by stamping trace-id on every metric point.

**Clock alignment** is the other half: events come from the renderer (`performance.timeOrigin`), main
(`Date.now()` inside Electron) and the runner. Carry the source clock on each event, or measure a
per-source offset and correct before joining — a skew larger than the join tolerance (±300 ms here)
silently mis-attributes.

### Capturing evidence *across* a hang
The capture must live **off the hung thread**. Three robust forms:
- **Out-of-process / sibling-thread stack grab.** Sentry's current path is the native-module
  `eventLoopBlockIntegration` (`@sentry/node-native`), which pauses threads via V8 native APIs — the
  older inspector-based ANR integration is **deprecated**. On the renderer, Electron ≥34
  `webFrameMain.collectJavaScriptCallStack()` returns a hung frame's live JS stack. It has **two**
  failure modes — wrap both: it *rejects* if the `Document-Policy` header opt-in is absent, and it
  *never resolves* if no JS is running.
- **Whole-run sampling that already covers the interval** (the harness's L6). Blind spot: V8 CPU
  samples are taken while JS is *running*, so a thread blocked in a syscall/native lock produces a
  *gap*, not a frame — sampling must be complemented by a pause/dump for pure-block hangs.
- **Ring-buffer breadcrumbs flushed on freeze** (the harness's breadcrumbs) — the app-domain "what
  was it doing right before" a stack can't give.

> ⚠️ **Discarded on verification:** `node --report-on-signal` as an out-of-band hung-loop stack dump.
> The report is dispatched through libuv on the *next* loop turn, so a truly wedged synchronous loop
> never reaches the dispatch point, and signal-triggered reports are unsupported on Windows. Fine as
> a general diagnostic report; **not** a reliable hung-loop capture. Use the sibling-thread V8 pause.

### Actionable reporting
- **Artifacts-on-failure** for cost control (Playwright's `retain-on-failure` / `on-first-retry`).
  The harness's always-on L6 (~120 MB Tracing Service) is the `trace:'on'` analogue — the natural
  place to apply retain-on-incident.
- **Merged timeline** joined by the shared correlation key, with pivots span→logs/metrics→trace
  exemplars. The incident report is a hand-rolled version of this.
- **Regression gating** anchored to a green baseline with a warn/error tier (≈ CAUTION/FAIL),
  perception research as the static floor: RAIL 100 ms response / 50 ms task ([web.dev/rail](https://web.dev/articles/rail)),
  INP good ≤200 ms / poor >500 ms ([web.dev/inp](https://web.dev/articles/inp)),
  Nielsen 0.1/1/10 s ([nngroup](https://www.nngroup.com/articles/response-times-3-important-limits/)).

## 3. Gap analysis (research → existing layers)

| Capability | State of the art | Today | Gap / opportunity |
|---|---|---|---|
| **Hung main-thread stack** | Sibling-thread V8 pause; renderer `collectJavaScriptCallStack()` | L3 names loop-lag + overlapping `ipcMain` handler; no stack for compute/sync-fs/native blockers | **Largest main-side gap.** Watchdog-triggered V8-inspector pause over the existing inspect channel; on `unresponsive`, `collectJavaScriptCallStack()` (handle both failure modes). |
| **Main-process CPU profile** | inspector `Profiler` / `--cpu-prof` | L4 gives per-process CPU **%** only | `v8.cpu_profiler` tracing does **not** sample the main process ([electron#18372](https://github.com/electron/electron/issues/18372)) — so `trace.json` can't explain a main freeze. Capture on-demand around an L3 stall (start/stop is stop-the-world). |
| **Event-loop delay** | `monitorEventLoopDelay` histogram + `eventLoopUtilization` | plain `Date.now()` `setInterval`, single max | **Low-overhead swap** — p50/p99/max + monotonic clock; ELU catches low-CPU blocking syscalls. Keep gating on `histogram.max`. |
| **Source-map resolution** | symbolicate minified frames | absent in every layer that reports a location | **Highest-leverage cross-cutting gap** — against a bundled app, every "open this file:line" lands in `vendor.js`. Resolve at report time. |
| **Cross-stream IDs + clock skew** | `traceparent` at the IPC boundary; per-source clock | timestamp-only joins; ≥3 unreconciled clocks | Mint a runId + event/incident id; tag each event's clock source. |
| **Heap snapshot on OOM/leak** | inspector HeapProfiler / `--heapsnapshot-signal` | none — L4 names the pid, no retainer evidence | `v8.writeHeapSnapshot` is sync, ~2× heap, and has crashed Electron's main — trigger only on *confirmed* sustained growth, prefer signal/inspector. |
| **Minidump / crashReporter** | Crashpad minidump (all-thread stacks) | `mainDeath` records code+signal; L5 records reason | `crashReporter.start()` → symbolicatable dump in `app.getPath('crashDumps')`. GPU-process death is `child-process-gone` (type GPU) — distinct from renderer `unresponsive`/`render-process-gone`. Don't trust `reason==='oom'` ([electron#40426](https://github.com/electron/electron/issues/40426)). |
| **INP-style interaction metric** | input→next-paint latency, p75 vs 200/500 ms | L1 measures thread-block *duration* | L2's `blockingDuration` already covers input-delay+processing; the gap is joining a specific interaction to its next paint. |
| **Single merged timeline** | all signals on one axis by shared id | N JSONL + monotonic `trace.json` + video, joined by report prose | `trace.json` is already Chrome Trace Event format; emit a per-incident `ts/pid/tid` window + wall-clock↔monotonic offset. |

Where the harness is already strong, plainly: **L5** (Chromium's authoritative `unresponsive` /
`render-process-gone`, keyed by `wcId`), **L2** (LoAF), **L6** (whole-run sampling), **L8**
(`initiator`/`errorText`/`blockedReason` on never-resolving stalls). The gaps are about *reach*, not
wrong mechanisms.

## 4. Troubleshooting & freeze-prevention playbook

One row per freeze class the harness detects. *Proven by* = the layers that witness it.

| Freeze class | Cause | Proven by | Architectural prevention |
|---|---|---|---|
| **Renderer main-thread block** | long sync JS / layout thrash | L1 (duration), L2 (call site), L6 (stack) | Break tasks into ≤50 ms chunks that yield; prefer `scheduler.yield()` (beats `setTimeout`'s 5 ms nested floor; shipped Chrome 94). `scheduler.postTask()` for priority + `AbortSignal` cancel. Web Workers / OffscreenCanvas for compute; `requestIdleCallback` (with timeout) for background work. |
| **Main event-loop block** | compute/GC/sync-fs/native addon on the Node loop — freezes *all* windows | L3 (lag + handler), L4 (CPU/mem) | Never run CPU-bound/sync work on the loop; partition with `setImmediate`; offload CPU work to `worker_threads` (CPU only — async I/O beats workers there); escalate worker → BrowserWindow → `UtilityProcess`. |
| **Sync IPC / sync-deadlock** | `sendSync` into a slow/busy handler | L1 + L3 co-fire | Use async `invoke` ↔ `handle`. Electron warns off `sendSync` and `@electron/remote` ("far too easy to unknowingly block the UI thread"). |
| **IPC flood / backpressure** | high-frequency renderer→main streams saturate the channel | L7 (rate + channel), L3 (resulting block) | Coalesce / throttle / debounce / batch; ack-before-send backpressure. (Engineering practice on the async primitives, not an explicit Electron-doc recommendation.) |
| **Memory balloon / leak** | unremoved listeners, detached DOM, unbounded caches, retained windows | L4 (growth + pid), L5 (the OOM it precipitates) | `removeListener` on teardown; bound caches (LRU); `WeakMap`/`WeakRef`; destroy unused `BrowserWindow`/`webContents`; `--max-old-space-size` to fail fast/recoverably. |
| **GPU / renderer unresponsive** | renderer wedged long enough that Chromium's hang monitor fires | L5 (authoritative hang bracket) | Watchdog: on `unresponsive`/`render-process-gone`, `reload()` in a fresh process with a restart-rate limiter + state persistence. (GPU *process* crash is `child-process-gone` type GPU — a different path.) `unresponsive` is low-resolution (~seconds), so short freezes never reach L5. |
| **Renderer crash** | OOM / segfault / kill | L5 (event), `mainDeath` (if it cascades) | `crashReporter.start()` for minidumps; handle `render-process-gone` to relaunch; contain crash-prone work in a `UtilityProcess`. |
| **Subprocess hang / main death** | forked worker crash/hang; main OOM / SIGKILL | subprocess, `mainDeath` | Supervise children with heartbeats + bounded restart; **time-bound every await** (`AbortSignal.timeout()`) so the app never hangs on a corpse. |
| **Network/IPC stall (spinner)** | request in-flight past threshold; loop alive, CPU idle | L8 (`initiator` + `errorText`) | `AbortSignal.timeout(ms)` on every fetch/round-trip; combine with user-cancel via `AbortSignal.any()`; per-resourceType budgets. |

## 5. Prioritized recommendations for the harness

Highest-leverage first. **zero-overhead** = reclaims data already captured; **new collection** flags
any observer-effect cost.

1. **Source-map resolution at report time** — resolve `file:line:col` against the build's source maps
   for L2 scripts, jsErrors topFrame, L8 initiator. *Closes* the single highest-leverage cross-cutting
   gap (every pointer is minified against a bundled app). **Zero-overhead** (pure post-processing).
   *Do this first.*
2. **Stamp runId + event/incident id; tag each event's clock source.** *Closes* timestamp-only joins +
   invisible clock skew. **Zero new collection** — the clocks already exist; you're labeling them.
3. **Swap L3 to `monitorEventLoopDelay` + `eventLoopUtilization`.** Report `histogram.max` (keep
   gating on max) + p99 + an ELU delta. **Lower overhead than today** (native libuv sampling, no
   per-tick JS callback).
4. **On-demand main-process CPU profile** around an L3 stall (inspector `Profiler` → `.cpuprofile`).
   **New collection, observer-effect flagged** — stop-the-world, so on-demand only; gate behind a
   capability check (`Profiler` may hang on this Electron).
5. **Renderer hung-stack** via `collectJavaScriptCallStack()` in L5's `unresponsive` handler
   (Electron ≥34, both failure modes handled). **New but bounded** (fires only on an already-hung frame).
6. **Crash-time durability** — `crashReporter` minidumps; emit L8/L2 events live at the threshold
   crossing (not only at `stop()`) so a crash mid-freeze doesn't drop the evidence around it.
   (`process.log`, already added, is part of this tier.)
7. **Heap snapshot on confirmed sustained growth** (sparingly — sync, ~2× heap, crash-prone).
8. **Retain-on-incident for L6** — tame the always-on ~120 MB trace; fix truncation dropping the
   *oldest* (early-freeze) window.

**Lower priority:** PII redaction + run-dir retention (raw URLs/stacks/argv/`stderrTail` persist into
committed reports); per-layer (not just primaryLayer) baseline matching + stale-baseline warning;
multi-window coverage (L1/L2/jsErrors/breadcrumbs/L6/L8 only watch `firstWindow`); a full OpenTelemetry
merged-timeline export (recommendation #2's IDs are the cheap prerequisite — do those first).
