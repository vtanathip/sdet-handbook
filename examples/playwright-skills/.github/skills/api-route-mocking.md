## Skill: `apiRouteMocking`
**Description**: Intercepts network requests to mock API responses for deterministic testing.
**Triggers**: "Mock API", "Stub backend response", "Fake data"
**Instructions**:
1. Use `await page.route('**/api/endpoint', async route => ...);`.
2. Return a mock JSON response using `route.fulfill({ json: { ... } });`.

**Example**:
```typescript
import { test, expect } from '@playwright/test';

test('should display todos fetched from API', async ({ page }) => {
  // Intercept GET /api/todos before navigating
  await page.route('**/api/todos', async route => {
    await route.fulfill({
      status: 200,
      json: [
        { id: 1, title: 'Buy milk', completed: false },
        { id: 2, title: 'Walk the dog', completed: true },
      ],
    });
  });

  await page.goto('http://localhost:5173');

  // Assert the mocked data renders in the UI
  await expect(page.getByRole('listitem').filter({ hasText: 'Buy milk' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Walk the dog' })).toBeVisible();
});

test('should handle API error gracefully', async ({ page }) => {
  // Simulate a server error
  await page.route('**/api/todos', async route => {
    await route.fulfill({ status: 500, body: 'Internal Server Error' });
  });

  await page.goto('http://localhost:5173');

  await expect(page.getByText('Failed to load todos')).toBeVisible();
});
```