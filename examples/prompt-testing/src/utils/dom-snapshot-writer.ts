/// <reference lib="dom" />
import * as fs from 'fs';
import * as path from 'path';
import type { Page } from '@playwright/test';
import type { ResolvedAction } from '../reporter/report-types.js';

const ENABLED = process.env.DOM_SNAPSHOT === 'true';
const OUTPUT_DIR = path.join('results', 'dom-snapshots');

export async function writeDomSnapshot(
  page: Page,
  stepIndex: number,
  stepText: string,
  action: ResolvedAction,
): Promise<void> {
  if (!ENABLED) return;

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const [travelPath, domTree] = await Promise.all([
    resolveTravelPath(page, action),
    captureFullDomTree(page),
  ]);

  const meta = [
    `=== STEP ${stepIndex}: "${stepText}" ===`,
    `URL: ${page.url()}`,
    `Action: ${action.type}`,
    `Locator: ${action.locator}`,
    action.shadowHost ? `Shadow Host: ${action.shadowHost}` : null,
    action.frameSelector ? `Frame: ${action.frameSelector}` : null,
    action.value !== undefined ? `Value: ${action.value}` : null,
    `Confidence: ${action.confidence}`,
    `Reasoning: ${action.reasoning}`,
  ].filter((l): l is string => l !== null).join('\n');

  const content = [
    meta,
    '',
    '=== ELEMENT TRAVEL PATH ===',
    travelPath,
    '',
    '=== DOM SNAPSHOT ===',
    domTree,
  ].join('\n');

  const filename = toSafeFilename(stepIndex, stepText);
  fs.writeFileSync(path.join(OUTPUT_DIR, `${filename}.txt`), content, 'utf-8');
}

async function resolveTravelPath(page: Page, action: ResolvedAction): Promise<string> {
  const locator = action.locator;

  if (action.frameSelector) {
    // Evaluate inside the target frame
    const frame = resolveFrame(page, action.frameSelector);
    if (!frame) return `(frame not found: ${action.frameSelector})`;
    const framePath = await frame
      .evaluate(buildAncestorPathFn, locator)
      .catch((e: unknown) => `(error in frame: ${String(e)})`);
    return `(frame: ${action.frameSelector}) ${framePath}`;
  }

  if (action.shadowHost) {
    const result = await page
      .evaluate(
        ({ host, inner }) => {
          const hostEl = document.querySelector(host);
          if (!hostEl) return `(shadow host not found: ${host})`;
          const shadow = (hostEl as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
          if (!shadow) return `(no shadowRoot on: ${host})`;
          const target = shadow.querySelector(inner);
          if (!target) return `(element not found in shadow: ${inner})`;

          const hostPath = buildPath(hostEl);
          const shadowPath = buildPath(target, shadow);
          return `${hostPath} >> [shadow-root] > ${shadowPath}`;

          function buildPath(el: Element, root?: ShadowRoot | Document): string {
            const parts: string[] = [];
            let curr: Element | null = el;
            const boundary = root ?? document;
            while (curr && curr !== (boundary as unknown as Element)) {
              parts.unshift(describeEl(curr));
              curr = curr.parentElement;
            }
            return parts.join(' > ');
          }

          function describeEl(el: Element): string {
            const tag = el.tagName.toLowerCase();
            const id = el.id ? `#${el.id}` : '';
            const testid = el.getAttribute('data-testid')
              ? `[data-testid="${el.getAttribute('data-testid')}"]`
              : '';
            const cls =
              el.className && typeof el.className === 'string' && el.className.trim()
                ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
                : '';
            return `${tag}${id}${testid}${cls}`;
          }
        },
        { host: action.shadowHost, inner: locator },
      )
      .catch((e: unknown) => `(shadow path error: ${String(e)})`);
    return result;
  }

  return page.evaluate(buildAncestorPathFn, locator).catch((e: unknown) => `(path error: ${String(e)})`);
}

// Serializable function passed to page.evaluate for the main-document case
function buildAncestorPathFn(selector: string): string {
  const el = document.querySelector(selector);
  if (!el) return `(element not found: ${selector})`;
  const parts: string[] = [];
  let curr: Element | null = el;
  while (curr && curr.tagName) {
    const tag = curr.tagName.toLowerCase();
    const id = curr.id ? `#${curr.id}` : '';
    const testid = curr.getAttribute('data-testid')
      ? `[data-testid="${curr.getAttribute('data-testid')}"]`
      : '';
    const cls =
      curr.className && typeof curr.className === 'string' && curr.className.trim()
        ? '.' + curr.className.trim().split(/\s+/).slice(0, 3).join('.')
        : '';
    parts.unshift(`${tag}${id}${testid}${cls}`);
    curr = curr.parentElement;
  }
  return parts.join(' > ');
}

async function captureFullDomTree(page: Page): Promise<string> {
  const mainLines = await page.evaluate(walkDomFn).catch(() => [] as string[]);
  const sections: string[] = [mainLines.join('\n')];

  // Append each child frame's DOM under a labeled marker
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const frameId = frame.url() || frame.name() || '(unnamed)';
    const frameLines = await frame.evaluate(walkDomFn).catch(() => [] as string[]);
    sections.push(`\n[iframe: ${frameId}]\n${frameLines.join('\n')}`);
  }

  return sections.join('\n');
}

// Serializable walk function — no closure references
function walkDomFn(): string[] {
  const out: string[] = [];

  function walk(el: Element, depth: number): void {
    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'meta', 'noscript', 'link'].includes(tag)) return;

    const rect = el.getBoundingClientRect();
    const id = el.id ? `#${el.id}` : '';
    const testid = el.getAttribute('data-testid')
      ? `[data-testid="${el.getAttribute('data-testid')}"]`
      : '';
    const role = el.getAttribute('role') ? `[role="${el.getAttribute('role')}"]` : '';
    const label = el.getAttribute('aria-label')
      ? `[aria-label="${el.getAttribute('aria-label')}"]`
      : '';
    const cls =
      el.className && typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().replace(/\s+/g, '.').slice(0, 50)
        : '';
    const bounds = `[${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)}x${Math.round(rect.height)}]`;
    const text =
      el.children.length === 0
        ? (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80)
        : '';
    const visibleText = text ? ` "${text}"` : '';

    const indent = '  '.repeat(Math.min(depth, 10));
    out.push(`${indent}${tag}${id}${testid}${role}${label}${cls}${bounds}${visibleText}`);

    for (const child of Array.from(el.children)) walk(child, depth + 1);

    const shadow = (el as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
    if (shadow) {
      out.push(`${indent}  >> [shadow-root host="${tag}${id || testid || ''}"]`);
      for (const child of Array.from(shadow.children)) walk(child, depth + 2);
    }
  }

  walk(document.body, 0);
  return out;
}

function resolveFrame(page: Page, frameSelector: string): ReturnType<Page['frame']> {
  // Try matching by name or URL fragment first, then fall back to first child frame
  const parts = frameSelector.split(' >> ');
  const selector = parts[parts.length - 1].trim();
  return (
    page.frame({ name: selector }) ??
    page.frames().find((f) => f.url().includes(selector)) ??
    null
  );
}

function toSafeFilename(stepIndex: number, stepText: string): string {
  const safe = stepText
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 40);
  return `step-${String(stepIndex).padStart(2, '0')}-${safe}`;
}
