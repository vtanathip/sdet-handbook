import type { Page } from '@playwright/test';
import type { ResolvedAction } from '../reporter/report-types.js';

export class ChartHandler {
  /**
   * Executes a chart or canvas interaction using pixel coordinates.
   * Falls back to clicking the container element if no coordinates are set.
   */
  static async execute(page: Page, action: ResolvedAction): Promise<void> {
    if (action.coordinates) {
      const { x, y } = action.coordinates;
      if (action.type === 'chart_hover') {
        await page.mouse.move(x, y);
      } else {
        await page.mouse.click(x, y);
      }
      return;
    }

    // No coordinates — click the container element
    const el = page.locator(action.locator).first();
    if (action.type === 'chart_hover') {
      await el.hover();
    } else {
      await el.click();
    }
  }
}
