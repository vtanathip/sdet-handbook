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
