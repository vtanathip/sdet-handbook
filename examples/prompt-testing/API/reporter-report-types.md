# src/reporter/report-types.ts

## Purpose
Shared TypeScript type definitions used across the fixture, executor, and reporter. Single source of truth for all data shapes flowing through the pipeline.

## Types

### `ActionType`
Union of all supported interaction types:

```ts
type ActionType =
  | 'click' | 'fill' | 'select' | 'hover' | 'scroll'
  | 'wait' | 'assert_text' | 'assert_visible'
  | 'chart_hover' | 'chart_click' | 'iframe_action' | 'keyboard'
```

---

### `ResolvedAction`
The object returned by `ActionResolver` and consumed by `ActionExecutor`.

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `ActionType` | Yes | The interaction to perform |
| `locatorStrategy` | `'css' \| 'xpath' \| 'text' \| 'role' \| 'label' \| 'coordinates' \| 'pierce'` | Yes | How the locator was constructed |
| `locator` | `string` | Yes | Playwright locator string |
| `value` | `string` | No | Text to fill, option to select, or key to press |
| `frameSelector` | `string` | No | Iframe selector chain (e.g. `#outer >> #inner`) |
| `shadowHost` | `string` | No | CSS selector of the shadow host element |
| `coordinates` | `{ x: number; y: number }` | No | Viewport-relative pixel coordinates for chart interactions |
| `confidence` | `number` | Yes | 0–1 model confidence score |
| `reasoning` | `string` | Yes | One-sentence explanation from the model |
| `fallbackLocators` | `string[]` | No | Ordered alternative locators |

---

### `StepResult`
Captured metadata for a single executed test step. Attached to the Playwright report as JSON and consumed by `QualityReporter`.

| Field | Type | Description |
|---|---|---|
| `stepIndex` | `number` | 1-based position within the test |
| `stepText` | `string` | Original plain-English instruction |
| `resolvedAction` | `ResolvedAction` | What the AI decided to do |
| `status` | `'passed' \| 'failed' \| 'skipped'` | Execution outcome |
| `errorMessage` | `string?` | Error detail if status is `failed` |
| `aiConfidence` | `number` | Confidence score from the model (mirrors `resolvedAction.confidence`) |
| `aiReasoning` | `string` | Reasoning from the model (mirrors `resolvedAction.reasoning`) |
| `cacheHit` | `boolean` | `true` when the locator was served from cache — no AI call was made |
| `startTime` | `number` | Unix ms timestamp at step start |
| `durationMs` | `number` | Total step duration including AI calls |

---

### `TestSuiteReport`
Aggregated report for a suite, built incrementally by `QualityReporter.onTestEnd()`.

| Field | Type | Description |
|---|---|---|
| `suiteName` | `string` | Derived from the Playwright title path |
| `startTime` | `number` | Suite start timestamp |
| `totalDurationMs` | `number` | Sum of all test durations in the suite |
| `steps` | `StepResult[]` | All steps across all tests in the suite |
| `overallStatus` | `'passed' \| 'failed'` | Fails if any test in the suite failed |
