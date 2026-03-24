## Skill: `authSetup`
**Description**: Automates user authentication and saves storage state for reuse in other tests.
**Triggers**: "Login automatically", "Save auth state", "Setup user session"
**Instructions**:
1. Create a `global-setup.ts` file or a dedicated test.
2. Perform login actions (fill username/password, click login).
3. Wait for post-login state (e.g., dashboard URL).
4. Save state using `await page.context().storageState({ path: 'storageState.json' });`.

**Example — `tests/global-setup.ts`**:
```typescript
import { chromium, FullConfig } from '@playwright/test';

async function globalSetup(config: FullConfig) {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto('http://localhost:5173/login');

  // Fill login form
  await page.getByLabel('Email').fill('user@example.com');
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Login' }).click();

  // Wait until redirected to dashboard
  await page.waitForURL('**/dashboard');

  // Save authenticated session for all tests
  await page.context().storageState({ path: 'storageState.json' });
  await browser.close();
}

export default globalSetup;
```

**`playwright.config.ts` setup**:
```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  globalSetup: require.resolve('./tests/global-setup'),
  use: {
    storageState: 'storageState.json', // reuse session in every test
  },
});
```