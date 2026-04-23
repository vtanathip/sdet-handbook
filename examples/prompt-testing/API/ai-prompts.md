# src/ai/prompts.ts

## Purpose
Centralises all system and user prompt templates used by the AI pipeline. No logic — pure string exports.

## Exports

### `CLASSIFIER_SYSTEM`
System prompt for the intent classification call. Instructs the model to return:
```json
{ "needsVision": boolean, "elementType": "button|input|...", "complexity": "simple|complex" }
```
Triggers `needsVision=true` for charts, canvases, SVG interactions, or visually ambiguous elements.

### `CLASSIFIER_USER(stepText)`
User message template: wraps the plain-English step text.

---

### `DOM_RESOLVER_SYSTEM`
System prompt for DOM-based locator resolution. Key rules encoded in the prompt:

| Rule | Detail |
|---|---|
| Selector preference | Prefer `aria` roles/labels → `data-testid` → CSS class (last resort) |
| Text matching | Use CSS pseudo-selectors: `text="Sign In"` or `:text("Sign In")` — never Playwright API method names |
| Verification steps | Words like `should`, `verify`, `check`, `see`, `confirm` map to `assert_text` or `assert_visible` |
| Fallbacks | Return 2–3 `fallbackLocators` in priority order |
| Shadow DOM | When target is below a `>> [shadow-root]` marker, set `shadowHost` + `locatorStrategy: "pierce"` |
| Confidence | Return a 0–1 score; 1.0 = completely unambiguous match |

### `DOM_RESOLVER_USER(stepText, url, dom)`
User message template: injects step text, current URL, and the abbreviated DOM snapshot.

---

### `VISION_RESOLVER_SYSTEM`
System prompt for screenshot-based resolution. Returns pixel coordinates (`x`, `y`) alongside the container selector. Used for chart and canvas interactions where DOM selectors are insufficient.

### `VISION_RESOLVER_USER(stepText, url)`
User message template: injects step text and URL. The screenshot is attached separately as an `image_url` content part by `azure-client.ts`.

---

## Prompt → Model Mapping

| Prompt pair | Model used | When |
|---|---|---|
| `CLASSIFIER_SYSTEM / USER` | gpt-4o-mini | Every step — first call |
| `DOM_RESOLVER_SYSTEM / USER` | gpt-4o-mini | `needsVision=false` steps |
| `VISION_RESOLVER_SYSTEM / USER` | gpt-4o | `needsVision=true` or low-confidence DOM |
