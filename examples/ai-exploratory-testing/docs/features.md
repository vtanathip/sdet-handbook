# Key Features

## LLM-Driven Exploratory Testing

An AI agent (GitHub Copilot SDK) autonomously navigates a web application using the `playwright-cli` skill. The agent receives a persona and loop intent from the YAML config, then explores the app freely — clicking, filling forms, navigating — and writes structured bug findings to `findings.jsonl` without any scripted test steps.

## CDP Performance Monitoring

A second Playwright connection attaches to the same Chromium instance over CDP and polls `Performance.getMetrics` + `Memory.getDOMCounters` on a configurable interval. This captures JS heap size, DOM node count, event listener count, document count, and layout count — enabling memory-leak detection over long sessions.

## Three Append-Only JSONL Streams

Every run produces three independent, timestamp-aligned streams:

| Stream | Content |
|---|---|
| `events.jsonl` | All Copilot SDK session events: assistant messages, tool calls, token usage, idle signals, compaction, shutdown |
| `metrics.jsonl` | CDP metric samples: JS heap, DOM nodes, listeners, documents, layout count |
| `findings.jsonl` | Agent-authored bug reports: severity, title, repro steps, evidence path, agent confidence |

All three streams are joined by timestamp in the final `report.md`.

## Flexible Auth Modes

The orchestrator handles three authentication scenarios with no code changes — only config:

| Mode | When | Behaviour |
|---|---|---|
| `no-auth` | No `authStateFile` in config | Opens the URL directly |
| `login-then-save` | `authStateFile` set, file does not exist | Agent logs in using secrets; storage state saved for next run |
| `reuse` | `authStateFile` set, file exists | Agent loads saved state; skips login form |

Credentials are read from a dotenv file pointed to by `PLAYWRIGHT_MCP_SECRETS_FILE`. The secret value never appears in the agent transcript, `events.jsonl`, or screenshots — only the env var name does.

## Stuck Detector (Watchdog)

A `StuckDetector` subscribes to all session events. If no event arrives within the configured `stuckDetectorSec` threshold, it calls `session.abort()` on the current agent turn, preventing indefinite hangs. The counter resets on every event ping.

## Configurable Persona and Intent

Every aspect of agent behaviour is driven by the YAML config — no code changes needed to target a new app:

```yaml
appUrl: https://todomvc.com/
persona: |
  You are a curious QA engineer exploring todomvc.com for 5 minutes.
loopIntent: |
  Navigate the site, try adding and completing todo items ...
runDurationHours: 0.08333
samplerIntervalSec: 15
stuckDetectorSec: 60
```

## Graceful Shutdown

`Ctrl+C` triggers a clean teardown: the current agent turn finishes, the browser is closed by a final `CLOSE_PROMPT`, the CDP sampler stops, all JSONL buffers are flushed, and `report.md` is written before the process exits.

## End-of-Run Report

`buildReport()` joins all three JSONL streams and produces a markdown report with:
- Run duration and token usage summary
- Agent narrative (assistant messages paired with idle signals)
- Findings table sorted by severity
- Memory metric trend (JS heap over time)
- Screenshot inventory

## Runtime Skills Injection

The `playwright-cli` skill directory (`runtime-skills/playwright-cli/`) is injected directly into the Copilot SDK session at startup via `skillDirectories`. This gives the agent structured instructions for browser interaction without putting them in the system prompt, keeping the system prompt focused on the testing persona and app context.
