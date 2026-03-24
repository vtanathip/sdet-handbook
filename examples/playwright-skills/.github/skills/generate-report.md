## Skill: `generateReport`
**Description**: How to generate and view the HTML report.
**Triggers**: "Show coverage", "View report", "Test results"
**Instructions**:
1. Run `npx playwright show-report`.

**Example — Run tests and open report**:
```bash
# Run all tests (report is auto-generated in playwright-report/)
npx playwright test

# Open the HTML report in the browser
npx playwright show-report

# Run tests and immediately open report
npx playwright test --reporter=html ; npx playwright show-report
```

**Example — Configure multiple reporters in `playwright.config.ts`**:
```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'on-failure' }],
    ['list'],   // prints results in the terminal
    ['junit', { outputFile: 'results.xml' }], // for CI integration
  ],
});
```

**Example — GitHub Actions CI with uploaded report**:
```yaml
- name: Run Playwright tests
  run: npx playwright test

- name: Upload HTML report
  uses: actions/upload-artifact@v3
  if: always()
  with:
    name: playwright-report
    path: playwright-report/
    retention-days: 7
```