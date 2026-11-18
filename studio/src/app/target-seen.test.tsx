import { act } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithTargetSeen, type SeenProbe } from '../test/home-test-kit';

afterEach(() => {
  document.body.innerHTML = '';
});

const KEYS = [
  ['aws', 's3', 'buckets'],
  ['other', 'thing'],
  ['studio', 'config'],
  ['engine', 'connection-check', 8297],
] as const;

/** Fills the app's query client with an answer under each of `KEYS`. */
function fillCache(seen: SeenProbe): void {
  for (const key of KEYS) {
    seen.queryClient.setQueryData(key, { from: key[0] });
  }
}

function cachedKeys(seen: SeenProbe): unknown[] {
  return seen.queryClient
    .getQueryCache()
    .getAll()
    .map((query) => query.queryKey[0]);
}

function report(seen: SeenProbe, name: string | undefined, startedAt: number): number {
  let generation = -1;
  act(() => {
    generation = seen.current.report(name, startedAt);
  });
  return generation;
}

describe('the target seen (issue 486, R3)', () => {
  it('a first report local: the target seen is local, generation 0, no query dropped', () => {
    const { seen } = renderWithTargetSeen();
    fillCache(seen);
    expect(seen.current.name).toBeUndefined();

    expect(report(seen, 'local', 100)).toBe(0);

    expect(seen.current.name).toBe('local');
    expect(seen.current.generation).toBe(0);
    expect(cachedKeys(seen)).toEqual(['aws', 'other', 'studio', 'engine']);
  });

  it('a report of the same target: nothing changes', () => {
    const { seen } = renderWithTargetSeen();
    report(seen, 'local', 100);
    fillCache(seen);
    const before = seen.current;

    expect(report(seen, 'local', 200)).toBe(0);

    expect(seen.current).toBe(before);
    expect(cachedKeys(seen)).toEqual(['aws', 'other', 'studio', 'engine']);
  });

  it("a report of second started after the held one: second, generation 1; every query but Studio's own is gone", () => {
    const { seen } = renderWithTargetSeen();
    report(seen, 'local', 100);
    fillCache(seen);

    expect(report(seen, 'second', 200)).toBe(1);

    expect(seen.current.name).toBe('second');
    expect(seen.current.generation).toBe(1);
    expect(cachedKeys(seen)).toEqual(['studio', 'engine']);
    expect(seen.queryClient.getQueryData(['studio', 'config'])).toEqual({ from: 'studio' });
    expect(seen.queryClient.getQueryData(['engine', 'connection-check', 8297])).toEqual({ from: 'engine' });

    // And back: another change, another generation.
    fillCache(seen);
    expect(report(seen, 'local', 300)).toBe(2);
    expect(seen.current.name).toBe('local');
    expect(cachedKeys(seen)).toEqual(['studio', 'engine']);
  });

  it('a report of second whose request started before the request whose answer set local: ignored', () => {
    const { seen } = renderWithTargetSeen();
    report(seen, 'local', 500);
    fillCache(seen);

    expect(report(seen, 'second', 499)).toBe(0);

    expect(seen.current.name).toBe('local');
    expect(seen.current.generation).toBe(0);
    expect(cachedKeys(seen)).toEqual(['aws', 'other', 'studio', 'engine']);
  });

  it('a report of local that started later moves the order on: an older report of second is then ignored', () => {
    const { seen } = renderWithTargetSeen();
    report(seen, 'local', 100);
    report(seen, 'local', 400);

    expect(report(seen, 'second', 300)).toBe(0);
    expect(seen.current.name).toBe('local');
  });

  it('a query of the area in flight when the change is reported: cancelled, and its late answer is not in the cache', async () => {
    const { seen } = renderWithTargetSeen();
    report(seen, 'local', 100);
    let answer: (value: string) => void = () => undefined;
    let signal: AbortSignal | undefined;
    const fetching = seen.queryClient.fetchQuery({
      queryKey: ['aws', 's3', 'buckets'],
      queryFn: (context) => {
        signal = context.signal;
        return new Promise<string>((resolve) => {
          answer = resolve;
        });
      },
    });
    fetching.catch(() => undefined);
    expect(seen.queryClient.getQueryState(['aws', 's3', 'buckets'])?.fetchStatus).toBe('fetching');

    report(seen, 'second', 200);
    answer("local's buckets");
    await act(async () => {
      await Promise.resolve();
    });

    await expect(fetching).rejects.toBeDefined();
    expect(signal?.aborted).toBe(true);
    expect(seen.queryClient.getQueryData(['aws', 's3', 'buckets'])).toBeUndefined();
    expect(cachedKeys(seen)).toEqual([]);
  });

  it('a report without a target: ignored', () => {
    const { seen } = renderWithTargetSeen();
    expect(report(seen, undefined, 100)).toBe(0);
    expect(seen.current.name).toBeUndefined();

    report(seen, 'local', 200);
    fillCache(seen);
    expect(report(seen, undefined, 300)).toBe(0);
    expect(seen.current.name).toBe('local');
    expect(seen.current.generation).toBe(0);
    expect(cachedKeys(seen)).toEqual(['aws', 'other', 'studio', 'engine']);
  });
});
