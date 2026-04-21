import { test } from '../src/fixtures/nl-test.fixture.js';
import { config } from '../config/index.js';

test.describe('Dashboard Charts', () => {
  test.beforeEach(async ({ page, step }) => {
    await page.goto(config.baseUrl);
    await step(`Enter ${config.user.email} in the email field`);
    await step(`Enter ${config.user.password} in the password field`);
    await step('Click the Sign In button');
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
