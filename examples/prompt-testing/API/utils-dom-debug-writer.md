# src/utils/dom-debug-writer.ts

## Purpose
Before each action executes, captures three forms of evidence about the target element and page state: an annotated screenshot, a full page HTML dump, and a structured element JSON. Intended for human and AI investigation when a step fails or the wrong element is targeted.

## Exports

### `writeDomDebug(page, stepIndex, stepText, action): Promise<void>`

| Parameter | Type | Description |
|---|---|---|
| `page` | `Page` | Playwright page |
| `stepIndex` | `number` | 1-based step counter (used in filename) |
| `stepText` | `string` | Plain-English step text (used in filename) |
| `action` | `ResolvedAction` | The resolved action about to be executed |

**Returns:** `Promise<void>`

## Output

All three files share the same base name:
```
results/dom-debug/step-{NN}-{sanitized-step-text}.{ext}
```

Example: `results/dom-debug/step-01-click-on-login-button.{png,html,json}`

---

### `.png` — Annotated Screenshot

A full viewport screenshot taken **while the highlight overlay is visible** over the target element. The orange border and action badge are baked into the image — no post-processing or image library required.

- Uses `highlightElement()` with an 800ms debug duration, then `page.screenshot({ type: 'png' })`.
- The screenshot reflects the exact DOM and scroll position at the moment the action was about to execute.
- Works correctly for elements inside iframes and shadow DOM because `locator.boundingBox()` always returns viewport-relative coordinates.

---

### `.html` — Full Page HTML

The raw HTML of the page at action time, written to disk for interactive browser inspection.

- Main document: `page.content()`
- Each child iframe: `frame.content()` appended as `<!-- [iframe: <url>] -->` comment blocks
- Shadow DOM content is serialized inline by the browser in `outerHTML`

Open in any browser to inspect the exact DOM state, run devtools queries, or diff against an expected structure.

---

### `.json` — Element Debug JSON

Structured metadata about the target element and the action:

```json
{
  "stepIndex": 1,
  "stepText": "click on login button",
  "url": "http://localhost:3000/login",
  "timestamp": "2026-04-26T10:00:00.000Z",
  "action": {
    "type": "click",
    "locator": "button[data-testid='login-btn']",
    "locatorStrategy": "css",
    "confidence": 0.95,
    "reasoning": "...",
    "fallbackLocators": ["button.btn-primary", "button:has-text('Sign In')"]
  },
  "element": {
    "tagName": "button",
    "attributes": { "id": "login-btn", "data-testid": "login-btn", "class": "btn btn-primary" },
    "textContent": "Sign In",
    "outerHTML": "<button id=\"login-btn\" ...>Sign In</button>",
    "boundingBox": { "x": 320, "y": 400, "width": 120, "height": 40 },
    "isVisible": true
  }
}
```

`outerHTML` is capped at 1000 characters. If the element cannot be found (e.g. locator resolves to nothing), `element` contains `{ "error": "element not found: <selector>" }`.

## iframe / Shadow DOM support

| Context | Strategy |
|---|---|
| Plain DOM | `document.querySelector(locator)` in `page.evaluate()` |
| Shadow DOM | `shadowHost.shadowRoot.querySelector(locator)` when `action.shadowHost` is set |
| Iframe | `frame.evaluate()` on the frame matched by `action.frameSelector` |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DOM_DEBUG` | `false` | Set to `"true"` to enable debug file writing |

## Integration point
Called by `nl-test.fixture.ts` before `executor.execute()` in both the cache-hit and AI-resolved paths — alongside `writeDomSnapshot()`. Both utilities capture the pre-action state of the page.

## Relationship to other utilities

| Utility | Output | Best for |
|---|---|---|
| `dom-highlight.ts` | Visual overlay in recording | Watching which element was targeted |
| `dom-snapshot-writer.ts` | `.txt` DOM tree + travel path | Text-based DOM structure analysis |
| `dom-debug-writer.ts` | `.png` + `.html` + `.json` | Visual inspection, browser devtools, element attribute audit |
