# src/executor/chart-handler.ts

## Purpose
Handles interactions with SVG and canvas chart elements that cannot be reliably targeted with DOM selectors alone. Called by `ActionExecutor` when `action.type` is `chart_click` or `chart_hover`.

## Class: `ChartHandler`

### `static execute(page, action): Promise<void>`

| Parameter | Type | Description |
|---|---|---|
| `page` | `Page` | Playwright page object |
| `action` | `ResolvedAction` | Must have `type: 'chart_click'` or `'chart_hover'` |

**Logic:**

```
action.coordinates set?
    │
    ├─ YES ──► page.mouse.move(x, y)   [chart_hover]
    │      ──► page.mouse.click(x, y)  [chart_click]
    │
    └─ NO  ──► page.locator(action.locator).hover()  [chart_hover]
           ──► page.locator(action.locator).click()  [chart_click]
```

## Why pixel coordinates?
Chart libraries (e.g. Chart.js, D3, Recharts) render data points on a `<canvas>` or inside deeply nested `<svg>` elements. There are no stable DOM attributes to target individual bars, slices, or data points. The vision resolver (`VISION_RESOLVER_SYSTEM`) returns viewport-relative pixel positions so the handler can interact at exact visual locations regardless of the chart library used.

## Fallback behaviour
When no coordinates are available (e.g. vision resolver returned low confidence), the handler falls back to clicking the chart container element. This is less precise but prevents hard failures when coordinates cannot be determined.
