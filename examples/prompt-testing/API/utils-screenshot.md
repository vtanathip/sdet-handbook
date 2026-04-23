# src/utils/screenshot.ts

## Purpose
Captures a viewport screenshot of the current page and returns it as a base64-encoded PNG string for use in vision AI calls.

## Exports

### `captureScreenshotBase64(page): Promise<string>`

| Parameter | Type | Description |
|---|---|---|
| `page` | `Page` | Playwright page to screenshot |

**Returns:** `string` — base64-encoded PNG.

## Behaviour
- `fullPage: false` — captures only the visible viewport, not the full scrollable page. This keeps the image payload small and ensures the coordinates returned by the vision resolver match what is actually visible on screen.
- The base64 string is passed directly to `chatFull()` in `azure-client.ts`, which attaches it as a `data:image/png;base64,...` URL in the `image_url` content part of the user message.

## When it is called
`ActionResolver.resolveVision()` calls this when:
- The classifier sets `needsVision=true` (chart, canvas, SVG elements)
- The DOM resolver returns `confidence < AI_CONFIDENCE_THRESHOLD`

The screenshot is taken at the moment of resolution — immediately before the AI call — so the model sees the exact current state of the page.
