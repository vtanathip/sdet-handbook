import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAuthMode } from '../src/authMode.js';
import { buildFirstPrompt } from '../src/promptLibrary.js';
import type { Config } from '../src/config.js';

const base: Config = {
  appUrl: 'https://example.com',
  persona: 'p',
  loopIntent: 'i',
  runDurationHours: 1,
  samplerIntervalSec: 30,
  stuckDetectorSec: 120,
};

describe('resolveAuthMode', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'auth-')); });

  it('returns no-auth when no file configured', () => {
    expect(resolveAuthMode(undefined)).toBe('no-auth');
  });

  it('returns login-then-save when file missing', () => {
    expect(resolveAuthMode(join(dir, 'does-not-exist.json'))).toBe('login-then-save');
  });

  it('returns reuse when file exists', () => {
    const p = join(dir, 'auth.json');
    writeFileSync(p, '{}');
    expect(resolveAuthMode(p)).toBe('reuse');
  });
});

describe('buildFirstPrompt', () => {
  it('no-auth: just opens URL', () => {
    const p = buildFirstPrompt(base, 'no-auth');
    expect(p).toContain('playwright-cli open');
    expect(p).toContain(base.appUrl);
    expect(p).not.toMatch(/state-load|state-save|login/i);
  });

  it('reuse: runs state-load then open', () => {
    const cfg = { ...base, authStateFile: '/abs/auth.json' };
    const p = buildFirstPrompt(cfg, 'reuse');
    expect(p).toContain('state-load /abs/auth.json');
    expect(p).toContain(`playwright-cli open ${cfg.appUrl}`);
    expect(p).toContain('already be logged in');
  });

  it('login-then-save: includes login hint when present', () => {
    const cfg = { ...base, authStateFile: '/abs/auth.json', authLoginHint: 'Fill with LSEG_USER/LSEG_PASS' };
    const p = buildFirstPrompt(cfg, 'login-then-save');
    expect(p).toContain(`playwright-cli open ${cfg.appUrl}`);
    expect(p).toMatch(/LSEG_USER/);
  });

  it('login-then-save: falls back to generic guidance when no hint', () => {
    const cfg = { ...base, authStateFile: '/abs/auth.json' };
    const p = buildFirstPrompt(cfg, 'login-then-save');
    expect(p).toMatch(/PLAYWRIGHT_MCP_SECRETS_FILE/);
  });
});
