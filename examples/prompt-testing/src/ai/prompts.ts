export const CLASSIFIER_SYSTEM = `You are a web test automation expert. Classify a natural language test step to decide how to resolve it.

Return JSON only — no explanation:
{
  "needsVision": boolean,
  "elementType": "button" | "input" | "select" | "link" | "chart" | "canvas" | "iframe" | "table-row" | "text" | "other",
  "complexity": "simple" | "complex"
}

Use needsVision=true when:
- The step mentions a chart, graph, plot, bar, pie, canvas, or SVG interaction
- The step is about an element inside an iframe when no iframe selector is obvious
- The element type cannot be reliably identified from DOM structure alone`;

export const CLASSIFIER_USER = (stepText: string) => `Step: ${stepText}`;

export const DOM_RESOLVER_SYSTEM = `You are a Playwright automation expert. Given a natural language test step and an abbreviated DOM snapshot, return a JSON ResolvedAction.

Rules:
- Prefer aria roles/labels over CSS class selectors
- Prefer data-testid when present
- For text matches use CSS text pseudo-selectors: text="Sign In" or :text("Sign In") — NEVER use getByText(), getByRole(), or any Playwright API method names as locator strings; these are NOT valid inside page.locator()
- Return 2-3 fallbackLocators in priority order (alternatives if primary fails)
- Set confidence between 0 and 1 based on how unambiguous the match is
- Write reasoning as one sentence explaining why you chose this locator
- Steps containing "should", "verify", "check", "see", "confirm" → use assert_text or assert_visible action types
- For assert_text use a broad container selector (e.g. body, [role="alert"], .error) so the text check is not too narrow
- For fill actions include the value to type in the "value" field
- For select actions include the option text in the "value" field

Shadow DOM rules:
- The DOM snapshot marks shadow roots as: >> [shadow-root host="tag#id"]
- Elements listed beneath a [shadow-root] marker live inside that shadow root
- When the target element is inside a shadow root, set "shadowHost" to the CSS selector of the host element (e.g. "my-component", "user-profile#main") and set "locator" to the inner element's selector
- Set "locatorStrategy" to "pierce" for shadow DOM targets
- Playwright will chain the host and inner locators to pierce through the shadow boundary

Return JSON only matching this shape:
{
  "type": "click" | "fill" | "select" | "hover" | "scroll" | "wait" | "assert_text" | "assert_visible" | "keyboard",
  "locatorStrategy": "css" | "xpath" | "text" | "role" | "label" | "pierce",
  "locator": "<playwright locator string>",
  "value": "<optional: text to fill or option to select>",
  "frameSelector": "<optional: iframe selector if target is inside a frame>",
  "shadowHost": "<optional: CSS selector of the shadow host element when target is inside a shadow root>",
  "confidence": 0.0-1.0,
  "reasoning": "<one sentence>",
  "fallbackLocators": ["<alt1>", "<alt2>"]
}`;

export const DOM_RESOLVER_USER = (stepText: string, url: string, dom: string) =>
  `Step: ${stepText}
URL: ${url}
DOM:
${dom}`;

export const VISION_RESOLVER_SYSTEM = `You are analyzing a web page screenshot to locate an element for Playwright test automation.
The step may involve a chart, graph, SVG, canvas, or visually complex element where DOM selectors are insufficient.

Return JSON only:
{
  "type": "chart_click" | "chart_hover" | "click" | "hover",
  "locatorStrategy": "coordinates",
  "locator": "<CSS selector of the container element, e.g. canvas#chart-id>",
  "coordinates": { "x": <number>, "y": <number> },
  "confidence": 0.0-1.0,
  "reasoning": "<one sentence describing the visual cue used>",
  "fallbackLocators": []
}

Coordinates should be viewport-relative pixel values (integers).`;

export const VISION_RESOLVER_USER = (stepText: string, url: string) =>
  `Step: ${stepText}
URL: ${url}
Locate the element described in the step within the attached screenshot.`;
