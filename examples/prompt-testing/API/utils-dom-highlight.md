# src/utils/dom-highlight.ts

## Purpose
Injects a visible overlay on the target DOM element immediately before an action executes. The overlay is designed to be clearly captured in Playwright video recordings, providing a visual evidence trail showing which element was targeted for each test step.

## Exports

### `highlightElement(page, locator, label, durationMs?): Promise<void>`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | `Page` | — | Playwright page |
| `locator` | `Locator` | — | Resolved locator for the target element |
| `label` | `string` | — | Action badge text shown above the overlay (e.g. `"CLICK"`, `"FILL"`) |
| `durationMs` | `number` | `DOM_HIGHLIGHT_DURATION` | How long the overlay stays visible before fading out |

**Returns:** `Promise<void>`

## Behaviour

1. **Guard** — returns immediately (no-op) if `DOM_HIGHLIGHT` env var is not `"true"`, or if `label` is a passive action (`wait`, `assert_visible`, `assert_text`).
2. **Bounding box** — calls `locator.boundingBox()` to get the element's viewport-relative coordinates. Returns silently if the element has no bounding box (off-screen or hidden).
3. **Overlay injection** — runs `page.evaluate()` to inject a `position:fixed` overlay div over the element:
   - 4px orange border (`#ff4500`) expanded 3px beyond the element edges
   - Semi-transparent orange background fill
   - CSS `@keyframes __nl_pulse` glow animation (expanding box-shadow) — repeats for the full duration so the highlight is unmissable at any recording frame rate
   - Action badge div positioned above the overlay (`"CLICK"`, `"FILL"`, etc.)
4. **Pre-action pause** — awaits `page.waitForTimeout(DOM_HIGHLIGHT_PAUSE)` so the recording captures the overlay before the action fires (default 800ms).
5. **Auto-removal** — a `setTimeout` inside the browser removes the overlay with a fade-out transition after `durationMs`.

## iframe / Shadow DOM support
`locator.boundingBox()` always returns viewport-relative coordinates regardless of iframe nesting or shadow DOM depth, so the fixed-position overlay is always positioned correctly over the element.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DOM_HIGHLIGHT` | `false` | Set to `"true"` to enable highlighting |
| `DOM_HIGHLIGHT_PAUSE` | `800` | ms to hold before action fires (increase for slower recordings) |
| `DOM_HIGHLIGHT_DURATION` | `2000` | ms until overlay fades out |

## Integration point
Called by `ActionExecutor.execute()` after `resolveLocator()` and before `dispatch()`. Chart actions (`chart_click`, `chart_hover`) bypass this call since they use pixel coordinates rather than locators.

## Visual appearance

```
┌─────────────┐
│  CLICK      │  ← orange badge
├─────────────┤
│             │
│  [element]  │  ← orange pulsing border + faint fill
│             │
└─────────────┘
```
