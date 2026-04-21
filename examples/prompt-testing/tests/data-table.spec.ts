import { test } from '../src/fixtures/nl-test.fixture.js';
import { config } from '../config/index.js';

test.describe('Data Table', () => {
  test.beforeEach(async ({ page, step }) => {
    await page.goto(config.baseUrl);
    await step(`Enter ${config.user.email} in the email field`);
    await step(`Enter ${config.user.password} in the password field`);
    await step('Click the Sign In button');
  });

  test('edit a user row', async ({ step }) => {
    await step('Find the row for John Doe in the users table');
    await step('Click the Edit button in the John Doe row');
    await step('Change the Status field to Inactive');
    await step('Click Save Changes');
    await step('Verify the John Doe row now shows Inactive status');
  });

  test('filter table results', async ({ step }) => {
    await step('Enter John in the search filter field');
    await step('Verify only rows containing John are visible');
  });

  test('sort table by name column', async ({ step }) => {
    await step('Click the Name column header to sort ascending');
    await step('Verify the first row in the table is sorted alphabetically');
  });

  test('delete a user row', async ({ step }) => {
    await step('Find the row for Jane Smith in the users table');
    await step('Click the Delete button in the Jane Smith row');
    await step('Click the Confirm button on the delete confirmation dialog');
    await step('Verify Jane Smith no longer appears in the table');
  });
});
