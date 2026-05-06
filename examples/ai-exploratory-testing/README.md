# Agent Exploratory Testing

An LLM agent autonomously explores a web application, discovers bugs, and tracks memory trends — all driven by a single YAML config file. No scripted test steps.

## What it does

A GitHub Copilot agent opens a real browser, navigates your app freely, and writes structured findings. In parallel, a second process attaches to the same browser over CDP and samples performance metrics on a fixed interval. When the run ends, everything is joined into a markdown report.

```
your config.yaml
    ↓
agent explores the app via playwright-cli
    ↓
findings.jsonl  ←  bug reports written by the agent
metrics.jsonl   ←  JS heap, DOM nodes, listeners (sampled every N seconds)
events.jsonl    ←  full session event stream
    ↓
report.md
```

## Quick start

```bash
npm install
npm run smoke          # 5-minute run against todomvc.com
```

Output lands in `runs/<timestamp>/report.md`.

## How it's configured

Everything is a YAML file — no code changes needed to target a new app:

```yaml
appUrl: https://todomvc.com/
persona: |
  You are a curious QA engineer exploring todomvc.com for 5 minutes.
loopIntent: |
  Navigate the site, try adding and completing todo items across different
  framework examples. Note any UI inconsistencies or broken interactions.
  Call task_complete after each meaningful observation.
runDurationHours: 0.08333
samplerIntervalSec: 15
stuckDetectorSec: 60
```

Run with any config:

```bash
npx tsx src/index.ts --config config.myapp.yaml
```

## Authentication

For apps that require login, add `authStateFile` and `authLoginHint` to your config. The orchestrator handles three modes automatically:

| Mode | When |
|---|---|
| `no-auth` | No `authStateFile` set |
| `login-then-save` | `authStateFile` set, file does not yet exist |
| `reuse` | `authStateFile` set, file already exists |

Credentials are read from a dotenv file pointed to by `PLAYWRIGHT_MCP_SECRETS_FILE`. They never appear in the agent transcript or screenshots.

## Requirements

- Node.js 20+
- GitHub Copilot CLI installed and authenticated
- `playwright-cli` installed globally on PATH
- Windows, macOS, or Linux

## Documentation

| Doc | Contents |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Mermaid workflow diagram, module map, data flow sequences, output directory layout |
| [docs/design-decisions.md](docs/design-decisions.md) | Why CDP, .session files, JSONL streams, stuck detector, auth mode, Zod, and runtime skills were chosen |
| [docs/features.md](docs/features.md) | All key features explained: CDP monitoring, auth modes, stuck detector, runtime skills, report generation |
| [docs/how-it-works.md](docs/how-it-works.md) | Module-by-module walkthrough of every source file |
| [docs/testing.md](docs/testing.md) | How to run tests, test suite table, fixture guide, how to write new tests |
| [docs/usage.md](docs/usage.md) | Step-by-step usage, full config reference, npm scripts |
