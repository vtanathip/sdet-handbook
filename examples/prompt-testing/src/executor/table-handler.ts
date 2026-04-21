import type { Page } from '@playwright/test';

const MAX_SCROLL_ATTEMPTS = Number(process.env.TABLE_MAX_SCROLL_ATTEMPTS || 10);
const SCROLL_PX = 300;

export class TableHandler {
  /**
   * Finds a row in a div-based grid (role="grid" or role="table") that contains
   * rowMatcher text, then executes the innerLocator within that row.
   * Scrolls the grid container for virtual/windowed tables.
   */
  static async findRowAndAct(
    page: Page,
    rowMatcher: string,
    innerLocator: string,
    action: 'click' | 'hover' = 'click',
  ): Promise<void> {
    const grid = page.locator('[role="grid"], [role="table"], table').first();

    for (let attempt = 0; attempt < MAX_SCROLL_ATTEMPTS; attempt++) {
      const row = grid.locator('[role="row"], tr').filter({ hasText: rowMatcher }).first();
      if ((await row.count()) > 0) {
        const cell = row.locator(innerLocator).first();
        if (action === 'hover') {
          await cell.hover();
        } else {
          await cell.click();
        }
        return;
      }
      await grid.evaluate((el) => el.scrollBy(0, 300));
      await page.waitForTimeout(200);
    }

    throw new Error(
      `Row matching "${rowMatcher}" not found after ${MAX_SCROLL_ATTEMPTS} scroll attempts (${MAX_SCROLL_ATTEMPTS * SCROLL_PX}px)`,
    );
  }
}
