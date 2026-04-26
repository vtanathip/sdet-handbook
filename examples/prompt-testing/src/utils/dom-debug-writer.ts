/// <reference lib="dom" />
import * as fs from 'fs';
import * as path from 'path';
import type { Page } from '@playwright/test';
import type { ResolvedAction } from '../reporter/report-types.js';
import { highlightElement } from './dom-highlight.js';

const ENABLED = process.env.DOM_DEBUG === 'true';
const OUTPUT_DIR = path.join('results', 'dom-debug');

// Duration for the debug highlight (long enough for screenshot, short enough to not block)
const DEBUG_HIGHLIGHT_DURATION = 800;

export async function writeDomDebug(
  page: Page,
  stepIndex: number,
  stepText: string,
  action: ResolvedAction,
): Promise<void> {
  if (!ENABLED) return;

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const filename = toSafeFilename(stepIndex, stepText);

  // Resolve the target locator for highlight + element info
  const locator = resolveLocatorForDebug(page, action);

  // Inject highlight overlay, take screenshot while it's visible, then let it fade
  await highlightElement(page, locator, action.type.toUpperCase(), DEBUG_HIGHLIGHT_DURATION);
  const screenshotBuffer = await page.screenshot({ type: 'png', fullPage: false }).catch(() => null);
  if (screenshotBuffer) {
    fs.writeFileSync(path.join(OUTPUT_DIR, `${filename}.png`), screenshotBuffer);
  }

  // Full page HTML — main document + each child frame appended as comment blocks
  const mainHtml = await page.content().catch(() => '<!-- page.content() failed -->');
  const frameSections: string[] = [];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const frameId = frame.url() || frame.name() || '(unnamed)';
    const frameHtml = await frame.content().catch(() => '<!-- frame.content() failed -->');
    frameSections.push(`\n<!-- [iframe: ${frameId}] -->\n${frameHtml}\n<!-- [/iframe] -->`);
  }
  fs.writeFileSync(
    path.join(OUTPUT_DIR, `${filename}.html`),
    mainHtml + frameSections.join('\n'),
    'utf-8',
  );

  // Element debug JSON
  const elementInfo = await resolveElementInfo(page, action).catch((e: unknown) => ({
    error: String(e),
  }));

  const debugData = {
    stepIndex,
    stepText,
    url: page.url(),
    timestamp: new Date().toISOString(),
    action,
    element: elementInfo,
  };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, `${filename}.json`),
    JSON.stringify(debugData, null, 2),
    'utf-8',
  );
}

function resolveLocatorForDebug(page: Page, action: ResolvedAction) {
  const root = action.frameSelector ? resolveFrameLocator(page, action.frameSelector) : page;
  if (action.shadowHost) {
    return (root as Page).locator(action.shadowHost).locator(action.locator).first();
  }
  return (root as Page).locator(action.locator).first();
}

function resolveFrameLocator(page: Page, frameSelector: string) {
  const parts = frameSelector.split(' >> ');
  let fl = page.frameLocator(parts[0]);
  for (let i = 1; i < parts.length; i++) {
    fl = fl.frameLocator(parts[i]);
  }
  return fl;
}

async function resolveElementInfo(page: Page, action: ResolvedAction) {
  if (action.frameSelector) {
    // Resolve to the actual Frame object for evaluate
    const frame = page
      .frames()
      .find((f) => {
        const lastPart = action.frameSelector!.split(' >> ').pop()!.trim();
        return f.name() === lastPart || f.url().includes(lastPart);
      });
    if (!frame) return { error: `frame not found: ${action.frameSelector}` };
    return frame.evaluate(getElementDetailFn, action.locator);
  }

  if (action.shadowHost) {
    return page.evaluate(
      ({ host, inner }) => {
        const hostEl = document.querySelector(host);
        if (!hostEl) return { error: `shadow host not found: ${host}` };
        const shadow = (hostEl as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
        if (!shadow) return { error: `no shadowRoot on: ${host}` };
        const target = shadow.querySelector(inner) as HTMLElement | null;
        return target ? describeElement(target) : { error: `element not found in shadow: ${inner}` };

        function describeElement(el: HTMLElement) {
          const rect = el.getBoundingClientRect();
          const attrs: Record<string, string> = {};
          for (const attr of Array.from(el.attributes)) attrs[attr.name] = attr.value;
          return {
            tagName: el.tagName.toLowerCase(),
            attributes: attrs,
            textContent: (el.textContent || '').trim().slice(0, 200),
            outerHTML: el.outerHTML.slice(0, 1000),
            boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            isVisible: rect.width > 0 && rect.height > 0,
          };
        }
      },
      { host: action.shadowHost, inner: action.locator },
    );
  }

  return page.evaluate(getElementDetailFn, action.locator);
}

// Serializable function for page/frame evaluate
function getElementDetailFn(selector: string) {
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return { error: `element not found: ${selector}` };
  const rect = el.getBoundingClientRect();
  const attrs: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) attrs[attr.name] = attr.value;
  return {
    tagName: el.tagName.toLowerCase(),
    attributes: attrs,
    textContent: (el.textContent || '').trim().slice(0, 200),
    outerHTML: el.outerHTML.slice(0, 1000),
    boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    isVisible: rect.width > 0 && rect.height > 0,
  };
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
