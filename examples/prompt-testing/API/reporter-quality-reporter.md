# src/reporter/quality-reporter.ts

## Purpose
Playwright custom reporter that aggregates per-step AI metrics after a test run and writes two JSON reports to the `results/` directory.

## Class: `QualityReporter`
Implements Playwright's `Reporter` interface. Registered in `playwright.config.ts`.

### `onTestEnd(test, result): void`
Called by Playwright after each individual test completes.
- Reads all `nl-step-result` attachments from `result.attachments`.
- Parses each attachment as a `StepResult`.
- Merges steps into the named suite accumulator (keyed by title path).
- Accumulates `totalDurationMs` and flips `overallStatus` to `'failed'` on any non-passing test.

### `onEnd(): Promise<void>`
Called once after all tests complete. Creates `results/` directory and writes two files.

---

## Output Files

### `results/quality-report.json`
Per-step AI confidence audit. Useful for reviewing which locators the AI chose and how confident it was.

```json
{
  "generatedAt": "2026-04-23T10:00:00.000Z",
  "suites": [{
    "name": "Login Flow",
    "overallStatus": "passed",
    "steps": [{
      "index": 1,
      "text": "Enter user@example.com in the email field",
      "status": "passed",
      "confidence": 0.95,
      "reasoning": "Chose input[type=email] as it uniquely matches the email field.",
      "resolvedLocator": "input[type='email']",
      "locatorStrategy": "css",
      "cacheHit": false,
      "errorMessage": null
    }]
  }]
}
```

### `results/time-report.json`
Timing breakdown per step and suite. Useful for identifying slow AI calls and measuring cache effectiveness.

```json
{
  "generatedAt": "...",
  "suites": [{
    "name": "Login Flow",
    "totalMs": 8200,
    "aiResolvedMs": 7800,
    "cacheHitMs": 400,
    "cacheHitRate": "25%",
    "slowestStep": { "index": 3, "text": "Click the Sign In button", "durationMs": 3200 },
    "steps": [...]
  }]
}
```

**Key timing fields:**

| Field | Description |
|---|---|
| `aiResolvedMs` | Total ms spent on steps that required an AI call |
| `cacheHitMs` | Total ms spent on steps served from cache |
| `cacheHitRate` | Percentage of steps that hit the cache (higher = faster + cheaper) |
| `slowestStep` | The single step with the highest `durationMs` |

## Registration
```ts
// playwright.config.ts
reporter: [
  ['./src/reporter/quality-reporter.ts']
]
```
