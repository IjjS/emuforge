import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../lib/aws/request';
import { useTokenListing, type TokenPage } from './use-token-listing';

// The listing over a stand-in reader, whose calls the case settles one by one, so the case decides the order in
// which answers arrive. It names no service: the items are plain words.

interface Call {
  token: string | undefined;
  signal: AbortSignal;
  resolve: (page: TokenPage<string>) => void;
  reject: (error: unknown) => void;
}

const ENDPOINT = 'http://127.0.0.1:9999';

let calls: Call[];
let client: QueryClient;

const read = (_endpoint: string, token: string | undefined, signal: AbortSignal) =>
  new Promise<TokenPage<string>>((resolve, reject) => {
    calls.push({ token, signal, resolve, reject });
  });

beforeEach(() => {
  calls = [];
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } },
  });
});

afterEach(() => {
  client.clear();
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function listing(initial: { filter: string } = { filter: '' }) {
  return renderHook(
    ({ filter }: { filter: string }) =>
      useTokenListing({ key: ['test', 'things', filter], endpoint: ENDPOINT, operation: 'ListThings', read }),
    { wrapper, initialProps: initial },
  );
}

async function nth(n: number): Promise<Call> {
  await waitFor(() => {
    expect(calls.length).toBeGreaterThan(n);
  });
  return calls[n] as Call;
}

describe('a listing by token', () => {
  it('"next" asks with the last token; "previous" shows the page before; the end is open while a token came', async () => {
    const { result } = listing();
    expect(result.current.loading).toBe(true);
    const first = await nth(0);
    expect(first.token).toBeUndefined();
    act(() => {
      first.resolve({ items: ['a', 'b'], next: 't1' });
    });
    await waitFor(() => {
      expect(result.current.items).toEqual(['a', 'b']);
    });
    expect(result.current.openEnd).toBe(true);
    expect(result.current.pagesCount).toBe(1);

    act(() => {
      result.current.goToPage(2);
    });
    const second = await nth(1);
    expect(second.token).toBe('t1');
    expect(result.current.currentPage).toBe(2);
    act(() => {
      second.resolve({ items: ['c'] });
    });
    await waitFor(() => {
      expect(result.current.items).toEqual(['c']);
    });
    expect(result.current.openEnd).toBe(false);
    expect(result.current.pastEnd).toBe(false);

    act(() => {
      result.current.goToPage(1);
    });
    const again = await nth(2);
    expect(again.token).toBeUndefined();
    act(() => {
      again.resolve({ items: ['a', 'b'], next: 't1' });
    });
    await waitFor(() => {
      expect(result.current.items).toEqual(['a', 'b']);
    });
    expect(result.current.currentPage).toBe(1);
  });

  it('a page without a token is ignored', async () => {
    const { result } = listing();
    act(() => {
      result.current.goToPage(3);
    });
    expect(result.current.currentPage).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it('a refresh asks the shown page again with its token, keeping the page', async () => {
    const { result } = listing();
    act(() => {
      calls[0]?.resolve({ items: ['a'], next: 't1' });
    });
    await waitFor(() => {
      expect(result.current.openEnd).toBe(true);
    });
    act(() => {
      result.current.goToPage(2);
    });
    act(() => {
      calls[1]?.resolve({ items: ['b'], next: 't2' });
    });
    await waitFor(() => {
      expect(result.current.items).toEqual(['b']);
    });
    act(() => {
      result.current.refresh();
    });
    const refreshed = await nth(2);
    expect(refreshed.token).toBe('t1');
    expect(result.current.currentPage).toBe(2);
    act(() => {
      refreshed.resolve({ items: ['b2'], next: 't2' });
    });
    await waitFor(() => {
      expect(result.current.items).toEqual(['b2']);
    });
    expect(result.current.pagesCount).toBe(2);
    expect(result.current.openEnd).toBe(true);
  });

  it('a late answer of an earlier page does not replace a newer one', async () => {
    const { result } = listing();
    act(() => {
      calls[0]?.resolve({ items: ['a'], next: 't1' });
    });
    await waitFor(() => {
      expect(result.current.openEnd).toBe(true);
    });
    act(() => {
      result.current.refresh();
    });
    const older = await nth(1);
    act(() => {
      result.current.goToPage(2);
    });
    const newer = await nth(2);
    expect(older.signal.aborted).toBe(true);
    act(() => {
      newer.resolve({ items: ['second page'] });
    });
    await waitFor(() => {
      expect(result.current.items).toEqual(['second page']);
    });
    act(() => {
      older.resolve({ items: ['stale first page'], next: 'stale' });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.items).toEqual(['second page']);
    expect(result.current.currentPage).toBe(2);
  });

  it('a further page that comes back empty with no token → shown empty as the end; earlier pages can be gone back to', async () => {
    const { result } = listing();
    act(() => {
      calls[0]?.resolve({ items: ['a'], next: 't1' });
    });
    await waitFor(() => {
      expect(result.current.openEnd).toBe(true);
    });
    act(() => {
      result.current.goToPage(2);
    });
    act(() => {
      calls[1]?.resolve({ items: [] });
    });
    await waitFor(() => {
      expect(result.current.items).toEqual([]);
    });
    expect(result.current.pastEnd).toBe(true);
    expect(result.current.currentPage).toBe(2);
    expect(result.current.openEnd).toBe(false);
    act(() => {
      result.current.goToPage(1);
    });
    const back = await nth(2);
    expect(back.token).toBeUndefined();
    act(() => {
      back.resolve({ items: ['a'], next: 't1' });
    });
    await waitFor(() => {
      expect(result.current.items).toEqual(['a']);
    });
    expect(result.current.pastEnd).toBe(false);
  });

  it('a changed filter starts again from the first page', async () => {
    const { result, rerender } = listing();
    act(() => {
      calls[0]?.resolve({ items: ['a'], next: 't1' });
    });
    await waitFor(() => {
      expect(result.current.openEnd).toBe(true);
    });
    act(() => {
      result.current.goToPage(2);
    });
    await nth(1);
    rerender({ filter: 'other' });
    const filtered = await nth(2);
    expect(filtered.token).toBeUndefined();
    expect(result.current.currentPage).toBe(1);
    expect(result.current.pagesCount).toBe(1);
  });

  it('a failed page → its failure in the kind the states are shown from; a refresh asks it again', async () => {
    const { result } = listing();
    act(() => {
      calls[0]?.reject(new RequestError({ kind: 'not-implemented', operation: 'ListThings' }));
    });
    await waitFor(() => {
      expect(result.current.failure).toEqual({ kind: 'not-implemented', operation: 'ListThings' });
    });
    expect(result.current.items).toBeUndefined();
    expect(result.current.loading).toBe(false);
    act(() => {
      result.current.refresh();
    });
    const again = await nth(1);
    expect(again.token).toBeUndefined();
    act(() => {
      again.resolve({ items: ['a'] });
    });
    await waitFor(() => {
      expect(result.current.items).toEqual(['a']);
    });
    expect(result.current.failure).toBeUndefined();
  });

  it('reads the shown page again in place while `readAgainAfter` asks for it, and no more once it does not', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { result } = renderHook(
        () =>
          useTokenListing({
            key: ['test', 'moving'],
            endpoint: ENDPOINT,
            operation: 'ListThings',
            read,
            readAgainAfter: (items) => (items.includes('moving') ? 1_000 : false),
          }),
        { wrapper },
      );
      act(() => {
        calls[0]?.resolve({ items: ['moving'] });
      });
      await waitFor(() => {
        expect(result.current.items).toEqual(['moving']);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      const again = await nth(1);
      expect(result.current.items).toEqual(['moving']);
      expect(result.current.loading).toBe(false);
      act(() => {
        again.resolve({ items: ['still'] });
      });
      await waitFor(() => {
        expect(result.current.items).toEqual(['still']);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });
      expect(calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
