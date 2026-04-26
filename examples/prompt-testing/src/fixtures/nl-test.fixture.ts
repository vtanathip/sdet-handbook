import { test as base } from '@playwright/test';
import type { StepResult, ResolvedAction } from '../reporter/report-types.js';
import { LocatorCache } from '../cache/locator-cache.js';
import { ActionResolver } from '../ai/action-resolver.js';
import { ActionExecutor } from '../executor/action-executor.js';
import { PageContextCapture } from '../utils/dom-serializer.js';
import { writeDomSnapshot } from '../utils/dom-snapshot-writer.js';
import { writeDomDebug } from '../utils/dom-debug-writer.js';

type NlFixtures = {
  /** Execute a natural-language test step against the current page */
  step: (text: string) => Promise<void>;
};

export const test = base.extend<NlFixtures>({
  step: async ({ page }, use, testInfo) => {
    const cache = new LocatorCache();
    const resolver = new ActionResolver(cache);
    const executor = new ActionExecutor(page);
    let stepIndex = 0;

    await use(async (text: string) => {
      stepIndex++;
      const startTime = Date.now();

      let resolved: ResolvedAction | undefined;
      let error: string | undefined;
      let cacheHit = false;

      // Try cache first
      const cached = cache.get(text, page.url());
      if (cached) {
        try {
          await writeDomSnapshot(page, stepIndex, text, cached);
          await writeDomDebug(page, stepIndex, text, cached);
          await executor.execute(cached);
          resolved = cached;
          cacheHit = true;
        } catch {
          // Cached locator is stale — fall through to AI resolution
        }
      }

      // AI resolution when cache missed or was stale
      if (!resolved) {
        try {
          const context = await PageContextCapture.capture(page);
          resolved = await resolver.resolve(text, context, page);
          await writeDomSnapshot(page, stepIndex, text, resolved);
          await writeDomDebug(page, stepIndex, text, resolved);
          await executor.execute(resolved);
        } catch (e: unknown) {
          error = e instanceof Error ? e.message : String(e);
        }
      }

      const result: StepResult = {
        stepIndex,
        stepText: text,
        resolvedAction: resolved ?? ({} as ResolvedAction),
        status: error ? 'failed' : 'passed',
        errorMessage: error,
        aiConfidence: resolved?.confidence ?? 0,
        aiReasoning: resolved?.reasoning ?? '',
        cacheHit,
        startTime,
        durationMs: Date.now() - startTime,
      };

      await testInfo.attach('nl-step-result', {
        body: Buffer.from(JSON.stringify(result)),
        contentType: 'application/json',
      });

      if (error) {
        throw new Error(`Step failed: "${text}" — ${error}`);
      }
    });
  },
});

export { expect } from '@playwright/test';
