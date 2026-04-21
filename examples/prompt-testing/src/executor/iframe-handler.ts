import type { Page, FrameLocator } from '@playwright/test';

export class IframeHandler {
  /**
   * Resolves a possibly nested frameSelector chain into a FrameLocator.
   * Supports chained selectors separated by " >> " e.g. "#outer >> #inner".
   */
  static resolve(page: Page, frameSelector: string): FrameLocator {
    const parts = frameSelector.split(' >> ');
    let fl: FrameLocator = page.frameLocator(parts[0]);
    for (let i = 1; i < parts.length; i++) {
      fl = fl.frameLocator(parts[i]);
    }
    return fl;
  }
}
