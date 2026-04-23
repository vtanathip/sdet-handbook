# src/executor/action-executor.ts

## Purpose
Executes a `ResolvedAction` against the live Playwright page. Handles frame resolution, shadow DOM piercing, fallback locators, and chart/canvas delegation.

## Class: `ActionExecutor`

### Constructor
```ts
new ActionExecutor(page: Page)
```

### `execute(action: ResolvedAction): Promise<void>`
Main dispatch method.

**Decision tree:**
1. If `action.type === 'chart_click'` or `'chart_hover'` → delegate to `ChartHandler`.
2. Build the Playwright `Locator`:
   - If `action.frameSelector` is set → resolve via `IframeHandler` first.
   - If `action.shadowHost` is set → chain `page.locator(shadowHost).locator(locator)`.
3. Call `dispatch(locator, action)`.
4. On failure → iterate `action.fallbackLocators`, attempt each in order, return on first success.
5. If all fallbacks fail → rethrow the original error.

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
