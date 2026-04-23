# src/ai/action-resolver.ts

## Purpose
Orchestrates the full AI resolution pipeline for a natural-language test step. Decides between the DOM path and vision path, handles retries, and writes results to the locator cache.

## Class: `ActionResolver`

### Constructor
```ts
new ActionResolver(cache: LocatorCache)
```

### `resolve(stepText, context, page?): Promise<ResolvedAction>`
Main entry point called once per test step.

**Pipeline:**
1. **Classify** — calls `chatMini` with `CLASSIFIER_SYSTEM` / `CLASSIFIER_USER` to get `{ needsVision, elementType, complexity }`.
2. **Route** — if `needsVision` or `elementType === 'chart' | 'canvas'`, go to vision path; otherwise attempt DOM path first.
3. **Confidence gate** — if DOM resolution returns `confidence < AI_CONFIDENCE_THRESHOLD`, escalates to vision path.
4. **Retry loop** — up to `MAX_RETRIES` total attempts before throwing.
5. **Cache write** — stores the resolved action keyed by `(stepText, url)`.

### Private: `resolveDom(stepText, context): Promise<ResolvedAction>`
Calls `chatMini` with the abbreviated DOM snapshot and `DOM_RESOLVER_SYSTEM` prompt. Returns a parsed `ResolvedAction`.

### Private: `resolveVision(stepText, context, page?): Promise<ResolvedAction>`
Optionally captures a screenshot, then calls `chatFull` with `VISION_RESOLVER_SYSTEM` prompt. Returns a parsed `ResolvedAction` with pixel coordinates.

## Resolution Flow Diagram

```
step text
    │
    ▼
[CLASSIFIER]  ── needsVision / chart / canvas ──► [VISION RESOLVER]
    │                                                     │
    │ simple DOM element                                  │
    ▼                                                     │
[DOM RESOLVER] ──► confidence < threshold ───────────────┘
    │
    ▼
[CACHE WRITE] ──► ResolvedAction returned to fixture
```

## Environment Variables
| Variable | Default | Description |
|---|---|---|
| `AI_CONFIDENCE_THRESHOLD` | `0.6` | Minimum confidence before escalating DOM → vision |
| `AI_MAX_RETRIES` | `2` | Max retry attempts per step |
