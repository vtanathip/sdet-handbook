import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../src/promptLibrary.js';
import type { Config } from '../src/config.js';

const base: Config = {
  appUrl: 'https://example.com',
  persona: 'You are an analyst.',
  loopIntent: 'Monitor news.',
  runDurationHours: 8,
  samplerIntervalSec: 30,
  stuckDetectorSec: 120,
  headed: false,
};

describe('buildSystemPrompt', () => {
  it('contains persona, intent, app URL, findings path', () => {
    const p = buildSystemPrompt(base, '/runs/abc/findings.jsonl');
    expect(p).toContain('You are an analyst.');
    expect(p).toContain('Monitor news.');
    expect(p).toContain('https://example.com');
    expect(p).toContain('/runs/abc/findings.jsonl');
  });

  it('includes shadow-DOM guidance', () => {
    const p = buildSystemPrompt(base, '/x.jsonl');
    expect(p).toMatch(/shadow/i);
    expect(p).toMatch(/snapshot/i);
    expect(p).toMatch(/aria/i);
  });

  it('includes race-awareness and evidence rules', () => {
    const p = buildSystemPrompt(base, '/x.jsonl');
    expect(p).toMatch(/race/i);
    expect(p).toMatch(/evidence/i);
    expect(p).toMatch(/task_complete/);
  });
});
