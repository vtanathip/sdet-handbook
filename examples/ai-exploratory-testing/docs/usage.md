# Usage

## Prerequisites

- Node.js 20+
- GitHub Copilot CLI installed and authenticated (`copilot` on PATH)
- `playwright-cli` installed globally and available on PATH
- Windows, macOS, or Linux (daemon path is resolved automatically per platform)

## Install

```bash
npm install
```

## Quick Smoke Run (no auth)

Run a 5-minute exploratory session against TodoMVC:

```bash
npm run smoke
```

This uses `config.smoke.yaml`. Output is written to `runs/<timestamp>/`.

## Run Against a Custom App

### 1. Create a config file

Copy `config.smoke.yaml` as a starting point:

```bash
cp config.smoke.yaml config.myapp.yaml
```

Edit `config.myapp.yaml`:

```yaml
appUrl: https://your-app.example.com/
persona: |
  You are a senior QA engineer testing the checkout flow of an e-commerce app.
  Focus on edge cases: empty cart, invalid coupon codes, address validation.
loopIntent: |
  Explore the cart and checkout pages. Try adding items, applying discounts,
  and completing an order. Report any error states or UI inconsistencies.
  Call task_complete after each meaningful observation.
runDurationHours: 0.5
samplerIntervalSec: 30
stuckDetectorSec: 120
```

> `config.myapp.yaml` is gitignored — safe to put real URLs in it.

### 2. Run

```bash
npx tsx src/index.ts --config config.myapp.yaml
```

## Authenticated Runs

### First run (login and save state)

1. Create a secrets file **outside the repo**:

   ```
   # e.g. C:/Users/you/.myapp-secrets.env
   MYAPP_USER=you@example.com
   MYAPP_PASS=your-real-password
   ```

2. Add auth fields to your config:

   ```yaml
   authStateFile: .myapp-auth.json       # written after first login; gitignored
   authLoginHint: Fill the username field with MYAPP_USER, password field with MYAPP_PASS, then click Sign In
   ```

3. Export the secrets file path and run:

   ```bash
   export PLAYWRIGHT_MCP_SECRETS_FILE=C:/Users/you/.myapp-secrets.env
   npx tsx src/index.ts --config config.myapp.yaml
   ```

   The agent logs in, saves storage state to `.myapp-auth.json`, then begins exploring.

### Subsequent runs (reuse saved state)

Once `.myapp-auth.json` exists, just run again — the orchestrator detects the file and loads it automatically without hitting the login form:

```bash
npx tsx src/index.ts --config config.myapp.yaml
```

### Parallel runs

All parallel runs can share the same `authStateFile` — they all `state-load` independently. If the site rotates session tokens, delete `authStateFile` to force a fresh login on the next run.

## Stopping a Run

`Ctrl+C` once. The orchestrator:
1. Finishes the current agent turn
2. Sends a `CLOSE_PROMPT` to cleanly close the browser
3. Stops the CDP sampler
4. Flushes all JSONL buffers
5. Writes `report.md`

## Reading the Output

Each run creates `runs/<ISO-timestamp>/`:

```
runs/2026-05-05T10-30-00-000Z/
  report.md             ← start here
  events.jsonl          ← full session event stream (messages, tool calls, usage)
  metrics.jsonl         ← CDP metric samples (heap, DOM nodes, listeners)
  findings.jsonl        ← agent-authored bug reports
  browser-endpoint.txt  ← CDP WebSocket URL used by the sampler
  screenshots/          ← evidence screenshots
```

Open `report.md` for the human-readable summary. Raw JSONL files are useful for programmatic analysis or debugging.

## Config Reference

| Field | Required | Default | Description |
|---|---|---|---|
| `appUrl` | yes | — | URL to explore |
| `persona` | yes | — | Agent identity — who it is and what it cares about |
| `loopIntent` | yes | — | What to do each turn and how to report findings |
| `runDurationHours` | yes | — | Total run time (e.g. `0.08333` ≈ 5 min, `0.5` = 30 min) |
| `samplerIntervalSec` | no | `30` | CDP polling interval |
| `stuckDetectorSec` | no | `120` | Seconds of silence before aborting the current agent turn |
| `seedNotes` | no | — | Optional extra context injected into the system prompt |
| `authStateFile` | no | — | Path to Playwright storage state; enables auth modes |
| `authLoginHint` | no | — | Login instructions for the agent (reference env var names, not values) |

## npm Scripts

| Script | Command | Description |
|---|---|---|
| `npm test` | `vitest run` | Run all unit tests once |
| `npm run test:watch` | `vitest` | Run tests in watch mode |
| `npm run typecheck` | `tsc --noEmit` | Type-check without emitting |
| `npm run start` | `tsx src/index.ts` | Run with default config |
| `npm run smoke` | `tsx src/index.ts --config config.smoke.yaml` | 5-minute smoke run |
