import { describe, it, expect } from 'vitest';
import { buildReport } from '../src/reportBuilder.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const fx = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('buildReport', () => {
  it('renders metric start/end trend', async () => {
    const md = await buildReport({
      eventsPath: join(fx, 'events-sample.jsonl'),
      metricsPath: join(fx, 'metrics-sample.jsonl'),
      findingsPath: join(fx, 'findings-sample.jsonl'),
    });
    expect(md).toMatch(/JSHeapUsedSize.*25000000/);
    expect(md).toMatch(/JSHeapUsedSize.*95000000/);
    expect(md).toMatch(/3\.8x/);
  });

  it('ranks findings by severity then timestamp', async () => {
    const md = await buildReport({
      eventsPath: join(fx, 'events-sample.jsonl'),
      metricsPath: join(fx, 'metrics-sample.jsonl'),
      findingsPath: join(fx, 'findings-sample.jsonl'),
    });
    const hi = md.indexOf('Chart never loads');
    const lo = md.indexOf('tooltip flicker');
    expect(hi).toBeLessThan(lo);
  });

  it('summarizes session events', async () => {
    const md = await buildReport({
      eventsPath: join(fx, 'events-sample.jsonl'),
      metricsPath: join(fx, 'metrics-sample.jsonl'),
      findingsPath: join(fx, 'findings-sample.jsonl'),
    });
    expect(md).toMatch(/task_complete.*1/);
    expect(md).toMatch(/compaction.*1/);
    expect(md).toMatch(/premiumRequests.*152/);
  });

  it('extracts narrative from assistant.message before each session.idle', async () => {
    const md = await buildReport({
      eventsPath: join(fx, 'events-sample.jsonl'),
      metricsPath: join(fx, 'metrics-sample.jsonl'),
      findingsPath: join(fx, 'findings-sample.jsonl'),
    });
    expect(md).toContain('Opened GOOG chart');
    expect(md).toContain('Switched to 1M view');
    expect(md).toMatch(/What the agent did \(2 turns\)/);
  });

  it('lists unique URLs visited', async () => {
    const md = await buildReport({
      eventsPath: join(fx, 'events-sample.jsonl'),
      metricsPath: join(fx, 'metrics-sample.jsonl'),
      findingsPath: join(fx, 'findings-sample.jsonl'),
    });
    // metrics-sample.jsonl has no `url` field on records, so URL section
    // should render the "none" fallback gracefully.
    expect(md).toMatch(/URLs visited/);
  });

  it('reports run duration + overview counts', async () => {
    const md = await buildReport({
      eventsPath: join(fx, 'events-sample.jsonl'),
      metricsPath: join(fx, 'metrics-sample.jsonl'),
      findingsPath: join(fx, 'findings-sample.jsonl'),
    });
    expect(md).toMatch(/Duration:.*\d+m \d+s/);
    expect(md).toMatch(/Events: \d+\s+\|\s+Metric samples: \d+/);
  });

  it('renders polite placeholders when sections are empty', async () => {
    const md = await buildReport({
      eventsPath: 'does-not-exist.jsonl',
      metricsPath: 'does-not-exist.jsonl',
      findingsPath: 'does-not-exist.jsonl',
    });
    expect(md).toContain('no assistant messages captured');
    expect(md).toContain('agent filed no bug reports');
    expect(md).toContain('none captured');
  });
});
