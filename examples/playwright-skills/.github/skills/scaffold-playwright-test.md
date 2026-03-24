## Skill: `scaffoldPlaywrightTest`
**Description**: Generates a robust Playwright test file following best practices (using locators, web-first assertions).
**Triggers**: "Write a test for...", "Test this feature...", "Create a spec file"
**Instructions**:
1. Import `test` and `expect` from `@playwright/test`.
2. Use `test.beforeEach` to navigate to the page if applicable.
3. Use `page.getByRole()`, `page.getByLabel()`, or `page.getByPlaceholder()` instead of CSS selectors.
4. assert state using `await expect(locator).toBeVisible()` or `toHaveText()`.

**Example**:
```typescript
import { test, expect } from '@playwright/test';

test.describe('Todo List App', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173');
  });

  test('should add a new task', async ({ page }) => {
    // Use semantic locators — never CSS selectors
    const input = page.getByPlaceholder('Enter a new task');
    const addButton = page.getByRole('button', { name: 'Add Task' });

    await input.fill('Buy milk');
    await addButton.click();

    // Web-first assertion — waits automatically
    await expect(page.getByRole('listitem').filter({ hasText: 'Buy milk' })).toBeVisible();

    // Verify input is cleared after submit
    await expect(input).toBeEmpty();
  });

  test('should not add an empty task', async ({ page }) => {
    const addButton = page.getByRole('button', { name: 'Add Task' });
    await addButton.click();

    // List should remain empty
    await expect(page.getByRole('list')).toBeEmpty();
  });
});
```