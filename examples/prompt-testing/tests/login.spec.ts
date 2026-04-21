import { test } from '../src/fixtures/nl-test.fixture.js';
import { config } from '../config/environments.js';
import { accounts } from '../config/test-accounts.js';

test.describe('Login Flow', () => {
  test('admin login succeeds', async ({ step, page }) => {
    await page.goto(config.baseUrl + config.loginPath);

    await step(`Enter ${accounts.admin.email} in the email field`);
    await step(`Enter ${accounts.admin.password} in the password field`);
    await step('Click the Sign In button');
    await step('Verify the dashboard heading is visible');
  });

  test('viewer has read-only access', async ({ step, page }) => {
    await page.goto(config.baseUrl + config.loginPath);

    await step(`Enter ${accounts.viewer.email} in the email field`);
    await step(`Enter ${accounts.viewer.password} in the password field`);
    await step('Click the Sign In button');
    await step('Verify the Edit button is not visible');
  });

  test('failed login shows error message', async ({ step, page }) => {
    await page.goto(config.baseUrl + config.loginPath);

    await step('Enter wronguser@example.com in the email field');
    await step('Enter incorrect-password in the password field');
    await step('Click the Sign In button');
    await step('Verify the error message says Invalid credentials');
  });
});
