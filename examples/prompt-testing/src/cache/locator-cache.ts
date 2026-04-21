import type { ResolvedAction } from '../reporter/report-types.js';

/**
 * In-memory locator cache scoped to a single test run.
 * Key = normalised stepText + pageUrl so locators don't bleed across routes.
 * On a cache hit the executor tries the stored action first; if the element is
 * stale the caller falls through to a fresh AI resolution.
 */
export class LocatorCache {
  private readonly store = new Map<string, ResolvedAction>();

  private key(stepText: string, url: string): string {
    // strip query params and hash so minor URL variations share a cache entry
    const base = url.split('?')[0].split('#')[0];
    return `${base}::${stepText.toLowerCase().trim()}`;
  }

  get(stepText: string, url: string): ResolvedAction | undefined {
    return this.store.get(this.key(stepText, url));
  }

  set(stepText: string, url: string, action: ResolvedAction): void {
    this.store.set(this.key(stepText, url), action);
  }

  size(): number {
    return this.store.size;
  }
}
