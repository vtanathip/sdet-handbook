# src/executor/iframe-handler.ts

## Purpose
Resolves a CSS iframe selector (or a chained sequence of nested selectors) into a Playwright `FrameLocator`. Used by `ActionExecutor` to target elements inside embedded frames.

## Class: `IframeHandler`

### `static resolve(page, frameSelector): FrameLocator`

| Parameter | Type | Description |
|---|---|---|
| `page` | `Page` | Playwright page |
| `frameSelector` | `string` | Single selector or `" >> "`-separated chain for nested iframes |

## Selector Chain Syntax
Multiple iframe levels are separated by ` >> `:

```ts
// Single frame
IframeHandler.resolve(page, '#payment-iframe')
// → page.frameLocator('#payment-iframe')

// Nested frames
IframeHandler.resolve(page, '#outer-frame >> #inner-frame')
// → page.frameLocator('#outer-frame').frameLocator('#inner-frame')
```

## Integration with ActionResolver
When the DOM resolver detects that a target element lives inside a frame, it sets `ResolvedAction.frameSelector`. `ActionExecutor` passes this value to `IframeHandler.resolve()` to get the root `FrameLocator`, then resolves the inner element locator against it.

## Limitation
Only works with frames accessible from the main page context. Cross-origin frames with `sandbox` restrictions or closed shadow roots are not reachable and will fall back to vision-based resolution.
