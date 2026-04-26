# src/fixtures/nl-test.fixture.ts

## Purpose
Playwright custom fixture that wires the `step()` function to the full AI resolution pipeline. This is the glue layer between plain-English test specs and the AI + executor infrastructure.

## Exports

### `test`
Extended Playwright `test` object with an added `step` fixture of type `NlFixtures`.

### `step(text: string): Promise<void>`
The only API that test specs interact with. Accepts a plain-English instruction and executes it against the current page.

## Full Execution Path per `step()` Call

```
step("Enter email in the email field")
    │
    ├─ 1. cache.get(text, url)
    │       ├─ HIT  ──► writeDomSnapshot()     (if DOM_SNAPSHOT=true)
    │       │       ──► writeDomDebug()         (if DOM_DEBUG=true)
    │       │       ──► executor.execute(cached) ──► success? ──► attach result ──► done
    │       │                                              └─ stale? ──► continue to AI
    │       └─ MISS ──► continue to AI
    │
    ├─ 2. PageContextCapture.capture(page)
    │       └─ { url, title, abbreviatedDom, activeFrames }
    │
    ├─ 3. ActionResolver.resolve(text, context, page)
    │       └─ ResolvedAction { type, locator, value, confidence, ... }
    │
    ├─ 4. writeDomSnapshot(page, stepIndex, text, resolved)   (if DOM_SNAPSHOT=true)
    │       └─ results/dom-snapshots/step-NN-<text>.txt
    │
    ├─ 5. writeDomDebug(page, stepIndex, text, resolved)      (if DOM_DEBUG=true)
    │       └─ results/dom-debug/step-NN-<text>.{png,html,json}
    │
    ├─ 6. ActionExecutor.execute(resolved)
    │       ├─ highlightElement() overlay shown  (if DOM_HIGHLIGHT=true)
    │       └─ Playwright interaction on live browser
    │
    └─ 7. Attach StepResult JSON ──► QualityReporter consumes this after the run
             └─ throw on error: 'Step failed: "<text>" — <error>'
```

## StepResult Attachment
Each step attaches a `StepResult` JSON blob to the Playwright test report under the name `nl-step-result`:

```ts
{
  stepIndex: number,
  stepText: string,
  resolvedAction: ResolvedAction,
  status: 'passed' | 'failed',
  errorMessage?: string,
  aiConfidence: number,
  aiReasoning: string,
  cacheHit: boolean,
  startTime: number,       // Unix ms
  durationMs: number,      // total including AI calls
}
```

## Usage in Test Specs
```ts
import { test } from '../src/fixtures/nl-test.fixture.js';

test('login succeeds', async ({ step, page }) => {
  await page.goto(config.baseUrl);
  await step('Enter user@example.com in the email field');
  await step('Enter password123 in the password field');
  await step('Click the Sign In button');
  await step('Verify the dashboard heading is visible');
});
```

## Notes
- `page` is still available from the standard Playwright fixture for direct `goto` calls.
- `step` is intentionally untyped beyond `string` — the AI handles all semantic interpretation.
- One `LocatorCache` and one `ActionResolver` are shared across all steps within a single test.
