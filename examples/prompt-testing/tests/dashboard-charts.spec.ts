import { test } from '../src/fixtures/nl-test.fixture.js';
import { config } from '../config/environments.js';
import { accounts } from '../config/test-accounts.js';

test.describe('Dashboard Charts', () => {
  test.beforeEach(async ({ page, step }) => {
    await page.goto(config.baseUrl + config.loginPath);
    await step(`Enter ${accounts.admin.email} in the email field`);
    await step(`Enter ${accounts.admin.password} in the password field`);
    await step('Click the Sign In button');
    await page.goto(config.baseUrl + config.dashboardPath);
  });

  test('hover over bar chart data point', async ({ step }) => {
    await step('Hover over the Q3 bar on the Revenue by Quarter chart');
    await step('Verify the tooltip appears with a value');
  });

  test('click bar chart segment to drill down', async ({ step }) => {
    await step('Click the Q4 bar on the Revenue by Quarter chart');
    await step('Verify the drill-down detail panel appears');
  });

  test('interact with pie chart segment', async ({ step }) => {
    await step('Click the largest segment on the Market Share pie chart');
    await step('Verify the segment label is highlighted');
  });
});
