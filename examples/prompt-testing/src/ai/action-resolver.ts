import type { ResolvedAction } from '../reporter/report-types.js';
import type { PageContext } from '../utils/dom-serializer.js';
import type { LocatorCache } from '../cache/locator-cache.js';
import { chatMini, chatFull } from './azure-client.js';
import { captureScreenshotBase64 } from '../utils/screenshot.js';
import {
  CLASSIFIER_SYSTEM,
  CLASSIFIER_USER,
  DOM_RESOLVER_SYSTEM,
  DOM_RESOLVER_USER,
  VISION_RESOLVER_SYSTEM,
  VISION_RESOLVER_USER,
} from './prompts.js';
import type { Page } from '@playwright/test';

const CONFIDENCE_THRESHOLD = Number(process.env.AI_CONFIDENCE_THRESHOLD || 0.6);
const MAX_RETRIES = Number(process.env.AI_MAX_RETRIES || 2);

interface ClassifierResult {
  needsVision: boolean;
  elementType: string;
  complexity: 'simple' | 'complex';
}

export class ActionResolver {
  constructor(private readonly cache: LocatorCache) {}

  async resolve(stepText: string, context: PageContext, page?: Page): Promise<ResolvedAction> {
    // Step 1: fast intent classification
    const classifierRaw = await chatMini([
      { role: 'system', content: CLASSIFIER_SYSTEM },
      { role: 'user', content: CLASSIFIER_USER(stepText) },
    ]);

    let classifier: ClassifierResult = { needsVision: false, elementType: 'other', complexity: 'simple' };
    try {
      classifier = JSON.parse(classifierRaw) as ClassifierResult;
    } catch {
      // default to DOM-only path
    }

    let action: ResolvedAction | undefined;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (classifier.needsVision || classifier.elementType === 'chart' || classifier.elementType === 'canvas') {
          action = await this.resolveVision(stepText, context, page);
        } else {
          action = await this.resolveDom(stepText, context);

          // Escalate to vision if DOM confidence is too low
          if (action.confidence < CONFIDENCE_THRESHOLD && page) {
            action = await this.resolveVision(stepText, context, page);
          }
        }

        if (action) {
          this.cache.set(stepText, context.url, action);
          return action;
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt === MAX_RETRIES) break;
      }
    }

    throw lastError ?? new Error(`Failed to resolve step: "${stepText}"`);
  }

  private async resolveDom(stepText: string, context: PageContext): Promise<ResolvedAction> {
    const raw = await chatMini([
      { role: 'system', content: DOM_RESOLVER_SYSTEM },
      { role: 'user', content: DOM_RESOLVER_USER(stepText, context.url, context.abbreviatedDom) },
    ]);
    return JSON.parse(raw) as ResolvedAction;
  }

  private async resolveVision(stepText: string, context: PageContext, page?: Page): Promise<ResolvedAction> {
    const screenshot = page ? await captureScreenshotBase64(page) : undefined;
    const raw = await chatFull(
      [
        { role: 'system', content: VISION_RESOLVER_SYSTEM },
        { role: 'user', content: VISION_RESOLVER_USER(stepText, context.url) },
      ],
      screenshot,
    );
    return JSON.parse(raw) as ResolvedAction;
  }
}
