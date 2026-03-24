## Skill: `debugTest`
**Description**: Provides commands to debug a failing test.
**Triggers**: "Debug this test", "Why is it failing?", "Troubleshoot test"
**Instructions**:
1. Suggest running with `--debug` flag: `npx playwright test --debug`.
2. Suggest using UI mode: `npx playwright test --ui`.
3. Suggest using VS Code debugger with breakpoints.

**Example — Debug Commands**:
```bash
# Step through test in Playwright Inspector (opens browser + inspector)
npx playwright test todo.spec.ts --debug

# Interactive UI mode with time-travel tracing
npx playwright test --ui

# Run a single test by title
npx playwright test -g "should add a new task"

# Show detailed trace after a failure
npx playwright show-trace test-results/traces/trace.zip
```

**Example — Add `page.pause()` to pause mid-test**:
```typescript
test('debug paused test', async ({ page }) => {
  await page.goto('http://localhost:5173');

  // Execution will pause here and open Playwright Inspector
  await page.pause();

  await page.getByPlaceholder('Enter a new task').fill('Buy milk');
});
```

**Example — Capture trace on failure in `playwright.config.ts`**:
```typescript
use: {
  trace: 'on-first-retry', // captures trace only when a test is retried
  screenshot: 'only-on-failure',
  video: 'retain-on-failure',
},
```