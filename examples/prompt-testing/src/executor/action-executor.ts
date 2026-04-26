import type { Page, Locator } from '@playwright/test';
import type { ResolvedAction } from '../reporter/report-types.js';
import { IframeHandler } from './iframe-handler.js';
import { ChartHandler } from './chart-handler.js';
import { highlightElement } from '../utils/dom-highlight.js';

export class ActionExecutor {
  constructor(private readonly page: Page) {}

  async execute(action: ResolvedAction): Promise<void> {
    if (action.type === 'chart_click' || action.type === 'chart_hover') {
      await ChartHandler.execute(this.page, action);
      return;
    }

    const locator = this.resolveLocator(action);
    await highlightElement(this.page, locator, action.type.toUpperCase());

    try {
      await this.dispatch(locator, action);
    } catch (primaryError) {
      // Try each fallback locator before giving up
      for (const fallback of action.fallbackLocators ?? []) {
        try {
          const fallbackAction = { ...action, locator: fallback };
          await this.dispatch(this.resolveLocator(fallbackAction), fallbackAction);
          return;
        } catch {
          // continue to next fallback
        }
      }
      throw primaryError;
    }
  }

  public resolveLocator(action: ResolvedAction): Locator {
    const root = action.frameSelector
      ? IframeHandler.resolve(this.page, action.frameSelector)
      : this.page;

    if (action.shadowHost) {
      return root.locator(action.shadowHost).locator(action.locator).first();
    }
    return root.locator(action.locator).first();
  }

  private async dispatch(locator: Locator, action: ResolvedAction): Promise<void> {
    switch (action.type) {
      case 'click':
        await locator.click();
        break;

      case 'fill':
        await locator.fill(action.value ?? '');
        break;

      case 'select':
        await locator.selectOption(action.value ?? '');
        break;

      case 'hover':
        await locator.hover();
        break;

      case 'scroll':
        await locator.scrollIntoViewIfNeeded();
        break;

      case 'wait':
        await locator.waitFor({ state: 'visible' });
        break;

      case 'keyboard':
        await locator.press(action.value ?? 'Enter');
        break;

      case 'assert_visible':
        await locator.waitFor({ state: 'visible', timeout: 10_000 });
        break;

      case 'assert_text': {
        const text = await locator.textContent();
        if (!text?.includes(action.value ?? '')) {
          throw new Error(
            `assert_text failed: expected "${action.value}" in "${text?.slice(0, 120)}"`,
          );
        }
        break;
      }

      default:
        throw new Error(`Unknown action type: ${(action as ResolvedAction).type}`);
    }
  }
}
