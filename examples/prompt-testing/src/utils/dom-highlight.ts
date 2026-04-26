/// <reference lib="dom" />
import type { Page, Locator } from '@playwright/test';

const ENABLED = process.env.DOM_HIGHLIGHT === 'true';
const DURATION_MS = Number(process.env.DOM_HIGHLIGHT_DURATION ?? 2000);
// How long to pause BEFORE the action so recordings clearly capture the highlight
const PAUSE_MS = Number(process.env.DOM_HIGHLIGHT_PAUSE ?? 800);

const PASSIVE_ACTIONS = new Set(['wait', 'assert_visible', 'assert_text']);

export async function highlightElement(
  page: Page,
  locator: Locator,
  label: string,
  durationMs = DURATION_MS,
): Promise<void> {
  if (!ENABLED || PASSIVE_ACTIONS.has(label.toLowerCase())) return;

  const box = await locator.boundingBox().catch(() => null);
  if (!box) return;

  await page.evaluate(
    ({ x, y, width, height, label: lbl, duration }) => {
      document.getElementById('__nl_highlight__')?.remove();

      // Inject keyframe animation for pulse effect
      const styleId = '__nl_highlight_style__';
      if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
          @keyframes __nl_pulse {
            0%   { box-shadow: 0 0 0 0 rgba(255,69,0,0.7), 0 0 14px rgba(255,69,0,0.5); }
            50%  { box-shadow: 0 0 0 8px rgba(255,69,0,0), 0 0 24px rgba(255,69,0,0.8); }
            100% { box-shadow: 0 0 0 0 rgba(255,69,0,0.7), 0 0 14px rgba(255,69,0,0.5); }
          }
        `;
        document.head.appendChild(style);
      }

      const el = document.createElement('div');
      el.id = '__nl_highlight__';
      el.style.cssText = [
        'position:fixed',
        `left:${x - 3}px`,
        `top:${y - 3}px`,
        `width:${width + 6}px`,
        `height:${height + 6}px`,
        'border:4px solid #ff4500',
        'background:rgba(255,69,0,0.15)',
        'z-index:2147483647',
        'pointer-events:none',
        'box-sizing:border-box',
        'animation:__nl_pulse 0.7s ease-in-out infinite',
      ].join(';');

      const badge = document.createElement('div');
      badge.textContent = lbl;
      badge.style.cssText = [
        'position:absolute',
        'top:-28px',
        'left:-4px',
        'background:#ff4500',
        'color:#fff',
        'font:bold 12px/26px monospace',
        'padding:0 10px',
        'border-radius:4px 4px 0 0',
        'white-space:nowrap',
        'letter-spacing:0.06em',
        'text-shadow:0 1px 2px rgba(0,0,0,0.4)',
      ].join(';');
      el.appendChild(badge);

      document.body.appendChild(el);
      setTimeout(() => {
        el.style.transition = 'opacity 0.3s';
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 350);
      }, duration);
    },
    { x: box.x, y: box.y, width: box.width, height: box.height, label, duration: durationMs },
  );

  // Hold here so the pulsing highlight is clearly visible in the recording before the action fires
  await page.waitForTimeout(PAUSE_MS);
}
