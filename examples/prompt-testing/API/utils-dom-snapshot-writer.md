# src/utils/dom-snapshot-writer.ts

## Purpose
Before each action executes, captures the full DOM state of the page and the ancestor path from root to the target element, writing both to a text file. Designed for debugging cases where the AI resolved to the wrong element or the DOM structure is unexpected.

## Exports

### `writeDomSnapshot(page, stepIndex, stepText, action): Promise<void>`

| Parameter | Type | Description |
|---|---|---|
| `page` | `Page` | Playwright page |
| `stepIndex` | `number` | 1-based step counter (used in filename) |
| `stepText` | `string` | Plain-English step text (used in filename) |
| `action` | `ResolvedAction` | The resolved action about to be executed |

**Returns:** `Promise<void>`

## Output

### File location
```
results/dom-snapshots/step-{NN}-{sanitized-step-text}.txt
```

Example: `results/dom-snapshots/step-01-click-on-login-button.txt`

### File format
```
=== STEP 1: "click on login button" ===
URL: http://localhost:3000/login
Action: click
Locator: button[data-testid="login-btn"]
Confidence: 0.95
Reasoning: Chose button with data-testid login-btn as it uniquely identifies the element.

=== ELEMENT TRAVEL PATH ===
html > body > div#root > form.login-form > button#login-btn.btn.btn-primary

=== DOM SNAPSHOT ===
body[0,0,1280x800]
  div#root.app[0,0,1280x800]
    form.login-form[320,200,640x400]
      input[type="email"][0,0,300x40] ""
      input[type="password"][0,0,300x40] ""
      button#login-btn.btn.btn-primary[0,0,120x40] "Sign In"
```

## Element Travel Path

The travel path shows the full ancestor chain from `html` down to the target element. The format varies by element context:

| Context | Format |
|---|---|
| Plain DOM | `html > body > div#root > ... > button#login-btn` |
| Shadow DOM | `html > body > div#app > my-widget >> [shadow-root] > button.submit` |
| Iframe | `(frame: #checkout-frame) html > body > input[name="card"]` |
| Nested iframe | `(frame: #outer >> #inner) html > body > input` |

Each segment shows up to: `tag#id[data-testid="..."].class1.class2.class3`

## Full DOM Tree

The tree walk is an untruncated version of the `dom-serializer.ts` snapshot with bounding boxes added per node. Key differences from the AI snapshot:

| Feature | AI snapshot (`dom-serializer`) | Debug snapshot |
|---|---|---|
| Token cap | Yes (`DOM_MAX_TOKENS × 4` chars) | No cap — full tree |
| Bounding boxes | No | Yes — `[x,y,widthxheight]` per node |
| Depth cap | 6 levels | 10 levels |
| Iframes | Listed by URL only | Each frame's DOM appended under `[iframe: <url>]` marker |
| Shadow DOM | Traversed | Traversed (same pattern) |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DOM_SNAPSHOT` | `false` | Set to `"true"` to enable snapshot writing |

## Integration point
Called by `nl-test.fixture.ts` before `executor.execute()` in both the cache-hit and AI-resolved paths. The snapshot reflects the DOM state at the moment of action resolution, before the action mutates the page.
