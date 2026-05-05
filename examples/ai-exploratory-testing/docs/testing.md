# Testing

## Running Tests

```bash
npm test           # run all unit tests once (vitest)
npm run test:watch # run in watch mode (re-runs on file save)
npm run typecheck  # TypeScript type-check without emitting (tsc --noEmit)
```

All 34 tests should pass. TypeScript should produce zero errors.

## Test Suite Overview

| File | Tests | What it covers |
|---|---|---|
| `test/authMode.test.ts` | 7 | `resolveAuthMode()` (all three modes), `buildFirstPrompt()` variants |
| `test/config.test.ts` | 5 | `loadConfig()` validation: required fields, defaults, invalid values |
| `test/daemonSession.test.ts` | 5 | `parseDaemonSession()`, `findCdpPort()` edge cases |
| `test/eventRecorder.test.ts` | 2 | Event subscription and JSONL append via `attachEventRecorder` |
| `test/jsonl.test.ts` | 2 | `JsonlWriter.append()` and `close()` round-trip |
| `test/personaPrompt.test.ts` | 3 | `buildSystemPrompt()` output contains persona, URL, findings path |
| `test/reportBuilder.test.ts` | 7 | `buildReport()` with fixture files: narrative, findings, metrics, empty streams |
| `test/stuckDetector.test.ts` | 3 | `StuckDetector` fires on silence, resets on ping, stops cleanly |

## Test Fixtures

All fixtures live in `test/fixtures/`:

| File | Used by |
|---|---|
| `daemon-session.json` | `daemonSession.test.ts` — valid session object for parse/port tests |
| `events-sample.jsonl` | `reportBuilder.test.ts` — sample events stream |
| `findings-sample.jsonl` | `reportBuilder.test.ts` — sample findings at different severities |
| `metrics-sample.jsonl` | `reportBuilder.test.ts` — sample CDP metric records |

## Writing New Tests

### Pure modules (no I/O)
Test through the public interface only. Example — testing `StuckDetector`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StuckDetector } from '../src/stuckDetector.js';

describe('StuckDetector', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires after threshold of silence', () => {
    const onStuck = vi.fn();
    const d = new StuckDetector({ thresholdSec: 10, onStuck });
    d.start();
    d.ping();
    vi.advanceTimersByTime(11_000);
    expect(onStuck).toHaveBeenCalledOnce();
    d.stop();
  });
});
```

Use `vi.useFakeTimers()` / `vi.advanceTimersByTime()` for any time-dependent logic.

### Config-loading tests
Use `tmp` directories and write real YAML to temp files:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';

const dir = mkdtempSync(join(tmpdir(), 'config-'));
const path = join(dir, 'test.yaml');
writeFileSync(path, `
appUrl: https://todomvc.com/
persona: tester
loopIntent: explore
runDurationHours: 0.1
`);
const cfg = loadConfig(path);
expect(cfg.appUrl).toBe('https://todomvc.com/');
```

### Auth mode tests
Use temp directories with `mkdtempSync` to create or omit state files — no mocking needed since `resolveAuthMode` only calls `existsSync`.

### Report builder tests
Write JSONL fixture files to a temp directory, point `buildReport` at them, assert on the returned markdown string. See `test/reportBuilder.test.ts` for examples.

## What Is Not Unit-Tested (By Design)

| Module | Reason |
|---|---|
| `src/sessionRunner.ts` | Wraps `@github/copilot-sdk` — requires a live Copilot CLI subprocess |
| `src/cdpSampler.ts` | Requires a live Chromium CDP endpoint |
| `src/monitoringBundle.ts` | Integration glue; covered by its components |
| `src/daemonDiscovery.ts` (discovery path) | Requires live daemon files; parse/port helpers are unit-tested via fixtures |
| `src/runCoordinator.ts` | Top-level wiring; covered by running `npm run smoke` end-to-end |

Integration-level coverage is provided by running `npm run smoke` against a real app.
