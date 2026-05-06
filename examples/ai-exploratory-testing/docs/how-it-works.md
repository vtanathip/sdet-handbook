# How It Works

## Entry Point — `src/index.ts`

`index.ts` is the CLI entry. It:
1. Reads `--config <path>` from `process.argv` (defaults to `config.local.yaml`)
2. Calls `loadConfig()` to parse and validate the YAML
3. Resolves `daemonRoot` per platform via `resolveDaemonRoot()`:
   - **Windows**: `%LOCALAPPDATA%\ms-playwright\daemon`
   - **macOS**: `~/Library/Application Support/ms-playwright/daemon`
   - **Linux**: `$XDG_DATA_HOME/ms-playwright/daemon` (falls back to `~/.local/share/ms-playwright/daemon`)
4. Calls `runOrchestration()` with the assembled options
5. Calls `process.exit(0)` after `runOrchestration` returns to force-clear any dangling handles (CDP WebSocket, child stdio)

## Config Loading — `src/config.ts`

`loadConfig(path)` reads a YAML file and validates it through a Zod schema:

| Field | Type | Default | Description |
|---|---|---|---|
| `appUrl` | URL string | required | App to explore |
| `persona` | string | required | Agent identity and testing style |
| `loopIntent` | string | required | What the agent should do each turn |
| `runDurationHours` | number | required | Total run time |
| `samplerIntervalSec` | integer | `30` | CDP polling interval |
| `stuckDetectorSec` | integer | `120` | Watchdog threshold before abort |
| `seedNotes` | string | — | Optional seed context for the agent |
| `headed` | boolean | — | Open the browser in headed (visible) mode |
| `authStateFile` | string | — | Path to Playwright storage state file |
| `authLoginHint` | string | — | Login instructions injected into first prompt |

Validation errors are thrown synchronously at startup before any browser is opened.

## Auth Mode Resolution — `src/authMode.ts`

`resolveAuthMode(authStateFile)` returns one of three modes used by `buildFirstPrompt`:

- **`no-auth`** — `authStateFile` is not set in config
- **`login-then-save`** — `authStateFile` is set but the file does not yet exist on disk
- **`reuse`** — `authStateFile` is set and the file exists (previous run saved state)

## Prompt Library — `src/promptLibrary.ts`

All LLM text lives in one file. This means changing agent behaviour requires editing only one place:

| Export | When sent | Content |
|---|---|---|
| `buildSystemPrompt(cfg, findingsPath)` | Session creation | Persona, app URL, loop intent, how to interact, how to verify, how to report findings (includes the absolute path to `findings.jsonl`) |
| `buildFirstPrompt(cfg, authMode)` | After session created | Opens the browser, handles auth: `playwright-cli open <url>`, `state-load`, or login steps |
| `STEP_PROMPT` | Each main loop iteration | Tells the agent to take its next exploratory step |
| `CLOSE_PROMPT` | Teardown | Tells the agent to close the browser and emit `task_complete` |

The system prompt instructs the agent to append one JSON line per finding to `findings.jsonl` directly via `bash echo`. The findings path is absolute so the agent can write it regardless of working directory.

## Session Runner — `src/sessionRunner.ts`

`SessionRunner` wraps the `@github/copilot-sdk` `CopilotClient` + `CopilotSession` pair:

- **`SessionRunner.create(opts)`** — creates a `CopilotClient`, opens a session with `approveAll` permission policy, injects `skillDirectories` and the system prompt, returns a `SessionRunner`
- **`sendAndWait(prompt, timeoutMs?)`** — sends a user message and waits for the session to reach `idle` or `task_complete`; default timeout 5 minutes
- **`abort()`** — cancels the current in-flight turn (called by `StuckDetector`)
- **`stop()`** — fully tears down: disconnects session(s) and kills the CLI subprocess

## Daemon Discovery — `src/daemonDiscovery.ts`

The playwright-cli daemon writes `.session` files under `daemonRoot/<hex>/`. Each file is a JSON object describing the running Chromium instance, including its `--remote-debugging-port` argument.

Discovery flow:
1. **`selfTestDaemon(daemonRoot)`** — scans for any `.session` files at startup; throws if none found (daemon not running)
2. **`discoverCdpWs(daemonRoot)`** — polls with retry until a `.session` file appears, parses it with `parseDaemonSession()`, extracts the port with `findCdpPort()`, then fetches `http://127.0.0.1:<port>/json/version` to get the `webSocketDebuggerUrl`
3. The resulting WebSocket URL is written to `browser-endpoint.txt` and handed to `MonitoringBundle`

## Run Artifacts — `src/runArtifacts.ts`

`RunArtifacts.create(runsRoot)` sets up the output directory for a single run:

- Creates `runs/<ISO-timestamp>/` and `runs/<ISO-timestamp>/screenshots/`
- Pre-creates `findings.jsonl` as an empty file (so the agent can always append to it)
- Opens two `JsonlWriter` instances: one for `events.jsonl`, one for `metrics.jsonl`
- Exposes a `paths` object with all absolute paths, so no other module needs to construct paths

`artifacts.close()` flushes and closes both writers.

## Event Recorder — `src/eventRecorder.ts`

`attachEventRecorder(runner, eventsWriter)` subscribes to all `SessionEvent` emissions from the session. Each event is timestamped and appended to `events.jsonl`. Returns an unsubscribe function called during teardown.

## Monitoring Bundle — `src/monitoringBundle.ts`

`MonitoringBundle` owns the lifecycle of three monitoring concerns as a single start/stop unit:

- **`CdpSampler`** — attaches to Chromium over CDP (`chromium.connectOverCDP(cdpWsUrl)`), polls `Performance.getMetrics` and `Memory.getDOMCounters` every `intervalSec` seconds, writes records to `metrics.jsonl`
- **`StuckDetector`** — checks every 1 second whether the time since the last session event exceeds `stuckDetectorSec`; if so, calls `runner.abort()`
- **Ping subscription** — subscribes to all session events and calls `stuck.ping()` to reset the watchdog timer

Callers only interact via `bundle.start()` and `bundle.stop()`.

## CDP Sampler — `src/cdpSampler.ts`

Each sample is written as one JSON line to `metrics.jsonl` with:

```json
{
  "ts": "2026-05-05T10:30:15.000Z",
  "url": "https://todomvc.com/",
  "JSHeapUsedSize": 12345678,
  "JSHeapTotalSize": 20000000,
  "Nodes": 412,
  "JSEventListeners": 88,
  "Documents": 3,
  "LayoutCount": 47
}
```

If multiple pages are open, only the last (most recently opened) page is sampled. A one-time warning is logged for multi-page sessions.

## Stuck Detector — `src/stuckDetector.ts`

Simple interval-based watchdog:
- Stores `lastPing = Date.now()` on each `ping()` call
- Checks every 1000 ms; if `Date.now() - lastPing >= thresholdSec * 1000`, calls `onStuck()` and resets `lastPing`
- `onStuck` in `MonitoringBundle` calls `runner.abort()` to cancel a hung turn

## Report Builder — `src/reportBuilder.ts`

`buildReport(input)` reads all three JSONL files and builds a markdown report:
- **Session narrative** — pairs each `assistant.message` event with the following `session.idle`, producing a timestamped turn-by-turn account
- **Token usage** — totals from `usage.*` events
- **Findings table** — findings sorted by severity (`high → medium → low`)
- **Memory trend** — JS heap over time from metrics samples
- **Screenshot inventory** — lists all files in `screenshots/`

The report is written to `runs/<timestamp>/report.md` after teardown.
