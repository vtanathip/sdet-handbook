# src/utils/dom-serializer.ts

## Purpose
Captures a condensed, token-safe text representation of the live page DOM and runs inside the browser context via `page.evaluate()`. This snapshot is the primary context fed to the DOM resolver AI call.

## Exports

### `PageContext` interface
```ts
interface PageContext {
  url: string;
  title: string;
  abbreviatedDom: string;    // serialized DOM text (token-capped)
  activeFrames: string[];    // URLs/names of non-main frames
}
```

### `PageContextCapture.capture(page): Promise<PageContext>`
Main entry point. Runs all four captures in parallel via `Promise.all` and returns a `PageContext`.

---

## Serialization Rules

The DOM walk executes inside `page.evaluate()` (browser context) so it has direct access to the live DOM tree.

### What is captured per element
```
<tag>#id[data-testid="..."][role="..."][aria-label="..."][placeholder="..."][type="..."][name="..."].class "leaf text"
```

### Skip rules (invisible / irrelevant nodes)
| Condition | Action |
|---|---|
| Tag is `script`, `style`, `meta`, `head`, `noscript`, `link` | Skip entirely |
| `getBoundingClientRect()` returns `width=0, height=0` (and tag ≠ `body`) | Skip — element is not visible |

### Special handling

| Element type | Behaviour |
|---|---|
| **SVG subtrees** | Full child walk skipped; `path/circle/rect/text` elements emit bounding boxes: `path[bounds="x,y,w,h"]` |
| **Grid / Table** | First 20 rows emitted as pipe-delimited cell text: `row[0]: Col1 \| Col2`; remaining rows shown as `(+ N more rows)` |
| **Shadow DOM** | Open shadow roots traversed; children preceded by marker: `>> [shadow-root host="tag#id"]` |
| **Text nodes** | Included only on leaf nodes (no child elements), truncated to 60 chars |
| **Class names** | Truncated to 30 chars to avoid bloating the snapshot with utility-class strings |
| **Depth** | Indentation capped at 6 levels to keep the output readable |

### Token cap
```
MAX_CHARS = DOM_MAX_TOKENS × 4
```
Output is hard-truncated at this length with a `… (truncated)` suffix to stay within model context windows.

---

## Environment Variables
| Variable | Default | Description |
|---|---|---|
| `DOM_MAX_TOKENS` | `4000` | Maximum token budget for the serialized DOM (~16 000 characters) |

---

## Example Output Snippet
```
body
  div#app.main-layout
    header[role="banner"]
      nav[aria-label="Main navigation"]
        a[data-testid="nav-home"] "Home"
        a[data-testid="nav-dashboard"] "Dashboard"
    main
      form#login-form
        input[type="email"][placeholder="Email address"][name="email"]
        input[type="password"][placeholder="Password"][name="password"]
        button[data-testid="btn-login"] "Sign In"
      >> [shadow-root host="user-card#profile"]
        div.avatar
        span.username "John Doe"
```
