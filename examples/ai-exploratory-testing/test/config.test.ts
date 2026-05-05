import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function tmp(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  const p = join(dir, 'c.yaml');
  writeFileSync(p, yaml);
  return p;
}

describe('loadConfig', () => {
  it('loads valid config', () => {
    const cfg = loadConfig(tmp(`
appUrl: https://example.com
persona: Analyst
loopIntent: monitor news
runDurationHours: 8
samplerIntervalSec: 30
stuckDetectorSec: 120
`));
    expect(cfg.appUrl).toBe('https://example.com');
    expect(cfg.runDurationHours).toBe(8);
  });

  it('rejects negative duration', () => {
    expect(() => loadConfig(tmp(`
appUrl: https://example.com
persona: Analyst
loopIntent: x
runDurationHours: -1
samplerIntervalSec: 30
stuckDetectorSec: 120
`))).toThrow(/runDurationHours/);
  });

  it('rejects non-http URL', () => {
    expect(() => loadConfig(tmp(`
appUrl: not-a-url
persona: Analyst
loopIntent: x
runDurationHours: 8
samplerIntervalSec: 30
stuckDetectorSec: 120
`))).toThrow(/appUrl/);
  });

  it('accepts optional authStateFile + authLoginHint', () => {
    const cfg = loadConfig(tmp(`
appUrl: https://example.com
persona: Analyst
loopIntent: monitor
runDurationHours: 1
samplerIntervalSec: 30
stuckDetectorSec: 120
authStateFile: .auth.json
authLoginHint: Fill username with LSEG_USER, password with LSEG_PASS, click Sign In
`));
    expect(cfg.authStateFile).toBe('.auth.json');
    expect(cfg.authLoginHint).toMatch(/LSEG_USER/);
  });

  it('works without auth fields (backward compat)', () => {
    const cfg = loadConfig(tmp(`
appUrl: https://example.com
persona: Analyst
loopIntent: monitor
runDurationHours: 1
samplerIntervalSec: 30
stuckDetectorSec: 120
`));
    expect(cfg.authStateFile).toBeUndefined();
    expect(cfg.authLoginHint).toBeUndefined();
  });
});
