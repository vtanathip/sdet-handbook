import { test } from '../src/fixtures/nl-test.fixture.js';
import { config } from '../config/index.js';

test.describe('Login Flow', () => {
  test('login succeeds', async ({ step, page }) => {
    await page.goto(config.baseUrl);

    await step(`Enter ${config.user.email} in the email field`);
    await step(`Enter ${config.user.password} in the password field`);
    await step('Click the Sign In button');
    await step('Verify the dashboard heading is visible');
  });

  test('failed login shows error message', async ({ step, page }) => {
    await page.goto(config.baseUrl);

    await step('Enter wronguser@example.com in the email field');
    await step('Enter incorrect-password in the password field');
    await step('Click the Sign In button');
    await step('Verify the error message says Invalid credentials');
  });
});
