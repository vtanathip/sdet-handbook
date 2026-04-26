# src/executor/action-executor.ts

## Purpose
Executes a `ResolvedAction` against the live Playwright page. Handles frame resolution, shadow DOM piercing, fallback locators, chart/canvas delegation, and pre-action DOM highlighting.

## Class: `ActionExecutor`

### Constructor
```ts
new ActionExecutor(page: Page)
```

### `execute(action: ResolvedAction): Promise<void>`
Main dispatch method.

**Decision tree:**
1. If `action.type === 'chart_click'` or `'chart_hover'` → delegate to `ChartHandler` (no highlight).
2. Build the Playwright `Locator` via `resolveLocator(action)`.
3. Call `highlightElement()` — injects an orange pulsing overlay so recordings show which element was targeted. Pauses `DOM_HIGHLIGHT_PAUSE` ms before proceeding (default 800ms). No-op if `DOM_HIGHLIGHT` is not `true`.
4. Call `dispatch(locator, action)`.
5. On failure → iterate `action.fallbackLocators`, attempt each in order, return on first success.
6. If all fallbacks fail → rethrow the original error.

### `resolveLocator(action: ResolvedAction): Locator` *(public)*
Builds the Playwright `Locator` from a `ResolvedAction`. Public so that external utilities (e.g. `dom-debug-writer`) can resolve the same locator without re-implementing the logic.

- If `action.frameSelector` is set → resolve root via `IframeHandler`.
- If `action.shadowHost` is set → chain `root.locator(shadowHost).locator(locator).first()`.
- Otherwise → `page.locator(locator).first()`.

## Action Types

| Type | Playwright Call | Notes |
|---|---|---|
| `click` | `locator.click()` | |
| `fill` | `locator.fill(value)` | `value` is required |
| `select` | `locator.selectOption(value)` | `value` is the option text |
| `hover` | `locator.hover()` | |
| `scroll` | `locator.scrollIntoViewIfNeeded()` | |
| `wait` | `locator.waitFor({ state: 'visible' })` | |
| `keyboard` | `locator.press(value)` | Default key: `Enter` |
| `assert_visible` | `locator.waitFor({ state: 'visible', timeout: 10_000 })` | |
| `assert_text` | `locator.textContent()` then substring check | Throws with detail if `value` not found |
| `chart_click` / `chart_hover` | Delegated to `ChartHandler` | Pixel coordinates or container click |

## Fallback Locator Strategy
`ResolvedAction.fallbackLocators` is an ordered array of alternative CSS selectors. On primary locator failure, the executor wraps each fallback in a try/catch and returns immediately on the first that succeeds. The original error is only thrown if every fallback also fails.

## Shadow DOM Piercing
When `action.shadowHost` is set:
```ts
page.locator(action.shadowHost).locator(action.locator).first()
```
Playwright chains the two locators, crossing the shadow boundary automatically.
