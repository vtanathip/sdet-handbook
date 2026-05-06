# Design Decisions

This document explains _why_ each major technical element exists — the problem it solves and why it was chosen over alternatives.

---

## CDP (Chrome DevTools Protocol)

### The problem

When an AI agent opens a browser and navigates a web app, the agent transcript tells you _what it did_, not _what the browser was doing underneath_. Memory leaks, growing DOM trees, and accumulating event listeners are invisible to the agent. You only notice them when things go wrong.

### Why CDP

CDP is the native debugging protocol built into every Chromium-based browser. It exposes low-level browser internals — JavaScript heap size, DOM node count, event listener count, active document count, layout operations — over a WebSocket. Playwright's `connectOverCDP` lets a second, independent process attach to an _already-running_ Chromium instance and query those metrics without interfering with the page.

This gives the tool a parallel observation channel that the agent itself cannot see or tamper with. The `CdpSampler` polls `Performance.getMetrics` and `Memory.getDOMCounters` on a configurable interval and writes each snapshot to `metrics.jsonl`. These samples are later joined with the agent narrative in `report.md` to show what was happening inside the browser at the moment each finding was logged.

**Alternative considered:** Screenshot diffing or DOM snapshots via Playwright's standard API. Rejected because they are coarse-grained and would require the agent to pause during capture.

---

## `.session` Files

### The problem

The tool does not launch Chromium directly. It tells the AI agent to run `playwright-cli open <url>`, and the agent executes that command inside the Copilot SDK session. The orchestrator process has no direct handle to the browser process — it does not know the CDP port, the process ID, or the WebSocket URL.

### Why `.session` files

`playwright-cli` writes a JSON `.session` file under the platform daemon directory (`%LOCALAPPDATA%\ms-playwright\daemon\<hex>\` on Windows, `~/Library/Application Support/ms-playwright/daemon/` on macOS, `~/.local/share/ms-playwright/daemon/` on Linux) every time it opens a browser. The file records how the browser was launched, including its `--remote-debugging-port` argument.

`daemonDiscovery.ts` polls this directory with retry until a file appears, parses it with a Zod schema, extracts the port, then fetches `http://127.0.0.1:<port>/json/version` to get the live WebSocket URL. This indirect handshake lets the orchestrator attach a CDP observer to a browser it did not spawn itself, with no shared memory or IPC.

The alternative — having the orchestrator launch Chromium directly — would break the design: the agent's `playwright-cli` skill would conflict with a separately managed browser process, and auth state would not flow through the agent's tool calls.

---

## JSONL Streams (Append-Only)

### The problem

A run can last hours. Writing everything to a single file and flushing at the end risks losing all data if the process crashes. Structured data (events, metrics, findings) also cannot coexist cleanly in one file.

### Why three separate JSONL streams

Each stream (`events.jsonl`, `metrics.jsonl`, `findings.jsonl`) is an append-only log of newline-delimited JSON objects. Each write is flushed immediately. Three independent streams serve different consumers:

| Stream | Written by | Consumed by |
|---|---|---|
| `events.jsonl` | `EventRecorder` (SDK subscription) | `buildReport()` — agent narrative |
| `metrics.jsonl` | `CdpSampler` (CDP polling) | `buildReport()` — memory trend |
| `findings.jsonl` | The AI agent (`bash echo`) | `buildReport()` — findings table |

Keeping them separate means each writer is isolated: a bug in one does not corrupt the others. `buildReport()` joins them at the end by timestamp alignment, not by shared state.

---

## Copilot SDK Session (`@github/copilot-sdk`)

### The problem

Driving a browser-using AI agent requires managing a stateful conversation: sending prompts, waiting for the model to finish tool calls (like `playwright-cli`), tracking token usage, handling compaction when the context fills, and cleanly shutting down. Building that from scratch against the raw API would be large and fragile.

### Why the Copilot SDK

The `@github/copilot-sdk` `CopilotClient` + `CopilotSession` pair manages all of that. `sendAndWait` blocks until the model reaches `idle` or `task_complete`, regardless of how many intermediate tool calls the agent makes. Session events (messages, tool calls, token usage, idle signals) are emitted as a typed stream that `EventRecorder` subscribes to.

The `skillDirectories` option injects the `playwright-cli` skill reference docs into the session at startup without polluting the system prompt. This gives the agent structured tool documentation while keeping the system prompt focused on the testing persona.

The `onPermissionRequest: () => ({ kind: 'approve-once' })` pattern automatically approves each tool call so the agent runs unattended. `approve-once` (not `approved`) is required because the Copilot CLI's interactive handler converts it to the final `approved` state internally.

---

## Stuck Detector

### The problem

LLM agents can silently stall — waiting for a page load that never completes, or stuck in a retry loop. A process that hangs indefinitely wastes time and compute.

### Why an event-based watchdog

`StuckDetector` subscribes to all SDK session events through `MonitoringBundle`. Every event — including minor idle signals — resets a `lastPing` timestamp. A 1-second polling interval checks whether `Date.now() - lastPing` has exceeded `stuckDetectorSec`. If so, it calls `runner.abort()` to cancel the current turn, letting the main loop either try again or exit cleanly.

This is coarser than per-operation timeouts but simpler: it requires no knowledge of what the agent is doing. The threshold is configurable per run so short smoke runs and long overnight sessions can have different tolerances.

---

## Auth Mode Resolution

### The problem

Different runs need different startup behaviour: a fresh app needs direct URL navigation, first-time auth needs a login flow, and subsequent runs should skip login entirely. Hard-coding any of this breaks reuse.

### Why file-presence detection

`resolveAuthMode(authStateFile)` derives the correct mode from a single observable fact: whether the `authStateFile` path exists on disk.

| Condition | Mode | Behaviour |
|---|---|---|
| `authStateFile` not set | `no-auth` | Open URL directly |
| `authStateFile` set, file missing | `login-then-save` | Agent logs in; state saved after |
| `authStateFile` set, file exists | `reuse` | Agent loads saved state; no login |

No flags, no environment variables, no separate config. The presence of the saved state file _is_ the source of truth. Deleting it forces a fresh login on the next run.

Credentials are read from a dotenv file pointed to by `PLAYWRIGHT_MCP_SECRETS_FILE`. Only the env var name appears in prompts and logs — never the credential value.

---

## Zod Schema Validation for Config

### The problem

YAML is untyped. A missing required field, a string where a number is expected, or an invalid URL would cause a confusing runtime crash deep inside the orchestrator rather than a clear error at startup.

### Why Zod at the boundary

`ConfigSchema` validates the parsed YAML object at the single entry point where config is loaded. Every required field is checked, every numeric field is coerced and range-validated, and URL format is verified before any browser is opened. Zod throws a structured error with field-level messages if anything is wrong. Defaults (`samplerIntervalSec: 30`, `stuckDetectorSec: 120`) are applied in the schema so they are guaranteed to be present in the validated output — no defensive `?? value` needed for those fields.

Optional fields (`headed`, `seedNotes`, `authStateFile`, `authLoginHint`) are marked `.optional()` so their absence is explicit in the TypeScript type (`boolean | undefined`, etc.) rather than a surprise `undefined` at runtime.

---

## Runtime Skills Injection

### The problem

The agent needs to know how to use `playwright-cli` — its commands, options, and expected behaviour. Putting all of that in the system prompt inflates every token count and makes the system prompt hard to read.

### Why `skillDirectories`

The Copilot SDK `skillDirectories` option injects documentation from a local directory into the session separately from the system prompt. The `runtime-skills/playwright-cli/` directory contains the same skill reference docs that `playwright-cli` itself publishes, plus references for element selection, request mocking, storage state, tracing, and video recording. The agent can consult these without them appearing in the user-visible conversation.

This keeps the system prompt focused on _what to test_ (persona, app URL, loop intent) while the skill directory handles _how to operate the browser_.

---

## Orchestrator Design (`runCoordinator.ts`)

### Overview

`runOrchestration()` is a sequential state machine with five phases. It is not an AI model — it is a TypeScript function that owns the run lifecycle and wires every other module together.

### Phase 1 — Setup

```
RunArtifacts.create()       output dir + three JSONL writers
selfTestDaemon()            fast-fail if daemon files are missing
SessionRunner.create()      CopilotClient + CopilotSession with skill dir + system prompt
attachEventRecorder()       session events → events.jsonl
```

### Phase 2 — Auth and browser open

The first agent turn uses a 10-minute timeout (`600_000 ms`). This is intentional: a `login-then-save` run may require the agent to fill in a login form and wait for a redirect, which can take several minutes on slow apps. No other turn uses this timeout.

If the auth mode is `login-then-save`, a second prompt is sent immediately after (2-minute timeout) to save the browser storage state to disk before any exploration begins.

### Phase 3 — CDP discovery and monitoring start

CDP discovery runs **after** the first agent turn, not before. The agent must call `playwright-cli open` to create the `.session` file; `discoverCdpWs()` polls for that file. Once the WebSocket URL is known, `MonitoringBundle` starts: `CdpSampler` begins polling metrics over CDP, and `StuckDetector` begins watching session events. Every session event — not just user-visible ones — resets the stuck detector's watchdog timer.

### Phase 4 — Main loop

```
while (!stopping && Date.now() < deadline):
  sendAndWait(STEP_PROMPT, 300_000 ms)
  on error: log, sleep 5 s, continue
```

The loop survives transient `sendAndWait` failures. A single failed turn does not end the run — the orchestrator logs the error, waits 5 seconds, and resumes. This handles temporary agent errors (e.g. a tool timeout mid-turn) without wasting the entire session.

### Phase 5 — Teardown (always in `finally`)

```
monitoring.stop()           StuckDetector off, CdpSampler disconnects
sendAndWait(CLOSE_PROMPT)   agent closes browser cleanly (60 s timeout)
runner.stop()               client.stop() kills CLI subprocess + closes sockets
artifacts.close()           flush all JSONL write buffers
buildReport()               join events + metrics + findings → report.md
```

Order is load-bearing: monitoring must stop before the runner so the stuck detector does not fire during teardown; JSONL buffers must flush before `buildReport()` reads them. The teardown block runs even if the main loop throws.

---

## Overall Architecture: Single Agent + Orchestrator

### The design

This is not a multi-agent system. There is one AI agent. The layers are:

**Orchestrator (`runCoordinator.ts`)** — The TypeScript process you run. It wires every module together, owns the run lifecycle (startup → main loop → teardown), and is not an AI model itself.

**AI Agent (`SessionRunner`)** — One `CopilotSession` wrapping GitHub Copilot. It receives prompts, executes `playwright-cli` tool calls to control the browser, and writes bug findings to `findings.jsonl`. `sendAndWait()` blocks until the agent reaches `idle`, regardless of how many intermediate tool calls it makes.

**Parallel Observer (not an agent)** — `CdpSampler` attaches to the browser over CDP independently of the agent and samples memory/DOM metrics on a timer. `StuckDetector` watches for session silence and aborts the current turn if the threshold is exceeded. Neither is an AI model; both are passive monitors.

**Three JSONL streams** — Each stream is written by a different layer and consumed at report time:

| Stream | Writer | Contains |
|---|---|---|
| `events.jsonl` | `EventRecorder` | Agent messages, tool calls, token usage |
| `metrics.jsonl` | `CdpSampler` | JS heap, DOM nodes, event listeners |
| `findings.jsonl` | The AI agent (`bash echo`) | Bug reports with severity and repro steps |

`buildReport()` joins all three by timestamp into `report.md` at teardown.

### Why not multi-agent

Splitting into multiple agents (e.g. one for navigation, one for validation, one for reporting) would add coordination overhead — shared state, inter-agent messaging, partial failure handling — without a clear benefit for exploratory testing, where a single coherent context window produces more consistent bug narratives than fragmented sub-agent outputs.

If parallel coverage is needed, the natural extension is running multiple independent `SessionRunner` instances concurrently (different personas or app areas), then merging their `findings.jsonl` outputs at the report stage — not introducing agent-to-agent communication.

---

## Orchestrator vs. Direct Code

### The problem

`runOrchestration()` imports from nine modules and wires them into a fixed sequence. The alternative — writing the entire run lifecycle as a single function or script — is simpler to write initially. Why add the indirection?

### Why the orchestrator layer

**Single lifecycle owner.** `runOrchestration()` is the only place that knows the full run sequence (startup → auth → browser open → monitoring → main loop → teardown). A `try/finally` block in one location guarantees that monitoring stops, JSONL buffers flush, and the report builds regardless of where a failure occurs. In direct code these exit paths scatter.

**Independently testable modules.** Because `SessionRunner`, `StuckDetector`, `MonitoringBundle`, and `ReportBuilder` know nothing about each other, each has its own unit tests without spinning up a browser or a live Copilot session. The agent's non-deterministic behaviour makes isolation especially valuable — a `StuckDetector` bug should be diagnosable without a real run.

**Cheap to swap implementations.** `resolveAuthMode()` returns an enum; the orchestrator branches on it. Adding a new auth strategy means editing one file and one branch — not hunting through 600 lines. The same applies to swapping the CDP sampler interval, changing the stuck threshold, or replacing the report format.

**Readable at a glance.** The ~80-line coordinator reads as a script of _what_ happens, not _how_. New contributors understand the run lifecycle without reading every module.

### The costs

**Indirection.** Finding a bug requires tracing from `runOrchestration()` through the responsible module. Each layer adds one file hop.

**God-object risk.** `runOrchestration()` already touches nine imports. If modules begin calling each other directly instead of surfacing state through the orchestrator, the design degrades into a hidden dependency graph — harder to follow than direct code.

**Interface boilerplate.** Each module boundary requires an options type (`CoordinatorOpts`, `MonitoringBundleOpts`, etc.). For a small one-shot script this is pure overhead.

### When direct code wins instead

| Scenario | Orchestrator | Direct code |
|---|---|---|
| Long-lived tool, multiple contributors | ✓ | |
| Unit test coverage required | ✓ | |
| Multiple swap-able strategies | ✓ | |
| One-shot automation script, <150 lines | | ✓ |
| Single fixed workflow, no test coverage needed | | ✓ |

The deciding factor for this codebase: because the AI agent's behaviour is non-deterministic, every supporting component (`StuckDetector`, `EventRecorder`, `ReportBuilder`) must be testable in isolation. That isolation requirement is what justifies the orchestrator boundary.
