import { describe, it, expect } from 'vitest';
import { parseDaemonSession, findCdpPort } from '../src/daemonDiscovery.js';
import { readFileSync } from 'node:fs';

const fixture = readFileSync(
  new URL('./fixtures/daemon-session.json', import.meta.url),
  'utf8',
);

describe('daemonSession', () => {
  it('parses a daemon .session file', () => {
    const s = parseDaemonSession(fixture);
    expect(s.name).toBe('example-session');
    expect(s.browser.launchOptions.args).toBeInstanceOf(Array);
  });

  it('extracts CDP port from launch args', () => {
    const s = parseDaemonSession(fixture);
    const port = findCdpPort(s);
    expect(port).toBeTypeOf('number');
    expect(port).toBeGreaterThan(1024);
    expect(port).toBe(54321);
  });

  it('throws if --remote-debugging-port missing', () => {
    const bad = JSON.stringify({
      name: 'x',
      socketPath: 'p',
      timestamp: 0,
      browser: { browserName: 'chromium', launchOptions: { args: [] } },
    });
    const s = parseDaemonSession(bad);
    expect(() => findCdpPort(s)).toThrow(/remote-debugging-port/);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseDaemonSession('not-json')).toThrow();
  });

  it('rejects missing browser.launchOptions.args', () => {
    const raw = JSON.stringify({
      name: 'x',
      socketPath: 'p',
      timestamp: 0,
      browser: { browserName: 'chromium' },
    });
    expect(() => parseDaemonSession(raw)).toThrow(/launchOptions/);
  });
});
