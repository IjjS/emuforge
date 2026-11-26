// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { preloadArea } from './area-preload';

describe('preloading the AWS area', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the loaded value and clears its timer', async () => {
    const area = {};
    await expect(preloadArea(() => Promise.resolve(area))).resolves.toBe(area);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with the original load error', async () => {
    const error = new Error('import failed');
    await expect(preloadArea(() => Promise.reject(error))).rejects.toBe(error);
  });

  it('is still pending at 119 999 ms', async () => {
    const settled = vi.fn();
    const preload = preloadArea(() => new Promise(() => undefined));
    const observed = preload.then(settled, settled);

    await vi.advanceTimersByTimeAsync(119_999);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await observed;
  });

  it('rejects at 120 000 ms with the load and its bound in the message', async () => {
    const preload = preloadArea(() => new Promise(() => undefined));
    const rejected = expect(preload).rejects.toThrow('The AWS area load did not finish within 120000 ms.');
    await vi.advanceTimersByTimeAsync(120_000);
    await rejected;
  });

  it('settles only once when the loader finishes after the deadline', async () => {
    let finish: (area: object) => void = () => undefined;
    const load = new Promise<object>((resolve) => {
      finish = resolve;
    });
    const resolved = vi.fn();
    const rejected = vi.fn();
    const observed = preloadArea(() => load).then(resolved, rejected);

    await vi.advanceTimersByTimeAsync(120_000);
    await observed;
    finish({});
    await load;
    await vi.advanceTimersByTimeAsync(0);

    expect(resolved).not.toHaveBeenCalled();
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
