import type { Page } from '@playwright/test';

export async function captureScreenshotBase64(page: Page): Promise<string> {
  const buffer = await page.screenshot({ type: 'png', fullPage: false });
  return buffer.toString('base64');
}
