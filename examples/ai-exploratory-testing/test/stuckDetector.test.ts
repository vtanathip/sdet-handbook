import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StuckDetector } from '../src/stuckDetector.js';

describe('StuckDetector', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires after threshold of silence', () => {
    const onStuck = vi.fn();
    const d = new StuckDetector({ thresholdSec: 10, onStuck });
    d.start();
    d.ping();
    vi.advanceTimersByTime(11_000);
    expect(onStuck).toHaveBeenCalledOnce();
    d.stop();
  });

  it('does not fire if pinged within threshold', () => {
    const onStuck = vi.fn();
    const d = new StuckDetector({ thresholdSec: 10, onStuck });
    d.start();
    vi.advanceTimersByTime(5_000);
    d.ping();
    vi.advanceTimersByTime(5_000);
    d.ping();
    vi.advanceTimersByTime(5_000);
    expect(onStuck).not.toHaveBeenCalled();
    d.stop();
  });

  it('does not fire after stop', () => {
    const onStuck = vi.fn();
    const d = new StuckDetector({ thresholdSec: 10, onStuck });
    d.start();
    d.stop();
    vi.advanceTimersByTime(20_000);
    expect(onStuck).not.toHaveBeenCalled();
  });
});
