## Skill: `visualRegression`
**Description**: Adds visual comparison assertions to detect UI changes.
**Triggers**: "Check visual layout", "Screenshot test", "Verify UI appearance"
**Instructions**:
1. Use `await expect(page).toHaveScreenshot('landing-page.png');`.
2. Mention the command to update snapshots: `npx playwright test --update-snapshots`.

**Example**:
```typescript
import { test, expect } from '@playwright/test';

test.describe('Visual Regression', () => {

  test('todo app matches baseline screenshot', async ({ page }) => {
    await page.goto('http://localhost:5173');

    // Compare the full page against a saved baseline image
    await expect(page).toHaveScreenshot('todo-empty-state.png');
  });

  test('todo list with items matches baseline', async ({ page }) => {
    await page.goto('http://localhost:5173');

    await page.getByPlaceholder('Enter a new task').fill('Buy milk');
    await page.getByRole('button', { name: 'Add Task' }).click();

    // Compare only a specific element instead of the full page
    const list = page.locator('.todo-list');
    await expect(list).toHaveScreenshot('todo-with-items.png');
  });

});
```

**To create or update baseline images**:
```bash
npx playwright test --update-snapshots
```