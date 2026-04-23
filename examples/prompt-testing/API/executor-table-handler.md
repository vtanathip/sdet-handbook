# src/executor/table-handler.ts

## Purpose
Handles row-level interactions in div-based virtual or windowed data tables where not all rows are present in the DOM simultaneously. Scrolls the table container and retries until the target row becomes visible.

## Class: `TableHandler`

### `static findRowAndAct(page, rowMatcher, innerLocator, action?): Promise<void>`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | `Page` | — | Playwright page |
| `rowMatcher` | `string` | — | Text substring used to identify the target row |
| `innerLocator` | `string` | — | CSS selector of the element to interact with inside the matched row |
| `action` | `'click' \| 'hover'` | `'click'` | Interaction to perform on the matched cell |

## Algorithm

```
1. Locate first [role="grid"], [role="table"], or <table> container
2. Filter rows by hasText: rowMatcher
3. Row found?
   ├─ YES ──► locate innerLocator within row ──► click/hover ──► return
   └─ NO  ──► scroll container by SCROLL_PX (300px) ──► wait 200ms ──► retry
4. After MAX_SCROLL_ATTEMPTS: throw descriptive error
```

## Virtual Table Support
Modern data grids (AG Grid, TanStack Table, React Virtuoso) only render visible rows in the DOM. `TableHandler` addresses this by programmatically scrolling the grid container with `el.scrollBy(0, 300)` after each failed row search, triggering the virtualizer to render new rows.

## Environment Variables
| Variable | Default | Description |
|---|---|---|
| `TABLE_MAX_SCROLL_ATTEMPTS` | `10` | Maximum scroll iterations before giving up (covers 3000px of virtual rows) |

## Error
On exhausted attempts:
```
Row matching "Jane Smith" not found after 10 scroll attempts (3000px)
```
