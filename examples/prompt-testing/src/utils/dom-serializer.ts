import type { Page } from '@playwright/test';

export interface PageContext {
  url: string;
  title: string;
  abbreviatedDom: string;
  activeFrames: string[];
}

const MAX_TOKENS = Number(process.env.DOM_MAX_TOKENS || 4000);
const CHARS_PER_TOKEN = 4;
const MAX_CHARS = MAX_TOKENS * CHARS_PER_TOKEN;

export class PageContextCapture {
  static async capture(page: Page): Promise<PageContext> {
    const [url, title, abbreviatedDom, activeFrames] = await Promise.all([
      page.url(),
      page.title(),
      PageContextCapture.serializeDom(page),
      PageContextCapture.listFrames(page),
    ]);
    return { url, title, abbreviatedDom, activeFrames };
  }

  private static async serializeDom(page: Page): Promise<string> {
    const lines = await page.evaluate(() => {
      const MAX_TEXT = 60;
      const MAX_CLASS = 30;
      const out: string[] = [];

      function truncate(s: string, n: number) {
        return s.length > n ? s.slice(0, n) + '…' : s;
      }

      function walk(el: Element, depth: number) {
        const tag = el.tagName.toLowerCase();

        // Skip invisible, script, style nodes
        if (['script', 'style', 'meta', 'head', 'noscript', 'link'].includes(tag)) return;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0 && tag !== 'body') return;

        const id = el.id ? `#${el.id}` : '';
        const testid = el.getAttribute('data-testid') ? `[data-testid="${el.getAttribute('data-testid')}"]` : '';
        const role = el.getAttribute('role') ? `[role="${el.getAttribute('role')}"]` : '';
        const label = el.getAttribute('aria-label') ? `[aria-label="${el.getAttribute('aria-label')}"]` : '';
        const placeholder = (el as HTMLInputElement).placeholder ? `[placeholder="${(el as HTMLInputElement).placeholder}"]` : '';
        const type = (el as HTMLInputElement).type ? `[type="${(el as HTMLInputElement).type}"]` : '';
        const name = (el as HTMLInputElement).name ? `[name="${(el as HTMLInputElement).name}"]` : '';
        const cls = el.className && typeof el.className === 'string' && el.className.trim()
          ? `.${truncate(el.className.trim().replace(/\s+/g, '.'), MAX_CLASS)}`
          : '';

        const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
        const visibleText = text && el.children.length === 0 ? ` "${truncate(text, MAX_TEXT)}"` : '';

        const indent = '  '.repeat(Math.min(depth, 6));
        out.push(`${indent}${tag}${id}${testid}${role}${label}${placeholder}${type}${name}${cls}${visibleText}`);

        // Compact SVG: emit bounding boxes instead of full subtree
        if (tag === 'svg') {
          const svgEls = el.querySelectorAll('path, circle, rect, text');
          svgEls.forEach((svgEl) => {
            const r = svgEl.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) return;
            const svgLabel = svgEl.getAttribute('aria-label') || svgEl.getAttribute('data-label') || '';
            out.push(`${indent}  ${svgEl.tagName.toLowerCase()}[bounds="${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}"]${svgLabel ? ` "${svgLabel}"` : ''}`);
          });
          return;
        }

        // Compact grid: emit header + first visible rows
        if (el.getAttribute('role') === 'grid' || el.getAttribute('role') === 'table') {
          const rows = Array.from(el.querySelectorAll('[role="row"]'));
          rows.slice(0, 20).forEach((row, i) => {
            const cells = Array.from(row.querySelectorAll('[role="gridcell"], [role="columnheader"], td, th'))
              .map((c) => (c.textContent || '').trim().slice(0, 30))
              .join(' | ');
            out.push(`${indent}  row[${i}]: ${cells}`);
          });
          if (rows.length > 20) out.push(`${indent}  (+ ${rows.length - 20} more rows)`);
          return;
        }

        for (const child of Array.from(el.children)) {
          walk(child, depth + 1);
        }

        // Traverse open shadow roots so AI can see shadow DOM elements
        const shadow = (el as any).shadowRoot;
        if (shadow) {
          out.push(`${indent}  >> [shadow-root host="${tag}${id || testid || ''}"]`);
          for (const child of Array.from(shadow.children) as any[]) {
            walk(child, depth + 2);
          }
        }
      }

      walk(document.body, 0);
      return out;
    });

    const full = lines.join('\n');
    return full.length > MAX_CHARS ? full.slice(0, MAX_CHARS) + '\n… (truncated)' : full;
  }

  private static async listFrames(page: Page): Promise<string[]> {
    return page.frames()
      .filter((f) => f !== page.mainFrame())
      .map((f) => f.url() || f.name())
      .filter(Boolean);
  }
}
