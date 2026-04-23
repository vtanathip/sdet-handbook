# src/cache/locator-cache.ts

## Purpose
In-memory cache that stores AI-resolved `ResolvedAction` objects for the duration of a test run. Prevents redundant AI calls for repeated steps on the same page.

## Class: `LocatorCache`

### `get(stepText, url): ResolvedAction | undefined`
Looks up a cached action. Returns `undefined` on miss.

### `set(stepText, url, action): void`
Stores an action. Overwrites any existing entry for the same key.

### `size(): number`
Returns the total number of cached entries.

## Cache Key Strategy
```
key = baseUrl :: normalised(stepText)
```
- Query parameters and hash fragments are stripped from the URL so minor URL variations share an entry.
- Step text is lowercased and trimmed for case-insensitive matching.

**Example:**
```
https://app.example.com/dashboard?tab=1#section
→ key base: https://app.example.com/dashboard

step: "Click the Sign In button"
→ key: "https://app.example.com/dashboard::click the sign in button"
```

## Staleness Handling
Cache hits are tried first by the fixture. If the element is stale (locator throws), execution falls through to a fresh AI resolution call. The new result then overwrites the stale entry via `set()`.

## Scope
One `LocatorCache` instance is created per test in the fixture. The cache does **not** persist between tests or test files.

## Cache Hit vs Miss Flow

```
step() called
    │
    ├─ cache.get(text, url) ──► HIT ──► executor.execute(cached)
    │                                        │
    │                                   success ──► done
    │                                        │
    │                                   stale error ──► fall through to AI
    │
    └─ MISS ──► AI resolution ──► executor.execute(resolved) ──► cache.set()
```
