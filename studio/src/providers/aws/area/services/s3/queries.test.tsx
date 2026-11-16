import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { FILTER_DELAY_MS, useBucketListing, type BucketListingOptions } from './queries';

// The test plays the engine behind the page's `fetch`. Each AWS request waits until the case answers it, so a case
// decides the order in which answers arrive.

interface SentRequest {
  query: URLSearchParams;
  signal: AbortSignal;
  answer: (buckets: string[], token?: string) => void;
}

class FakeEngine {
  readonly sent: SentRequest[] = [];

  readonly fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/__emuforge/session') {
      return Promise.resolve(new Response(JSON.stringify({ token: 'emuforge-test-token-56' }), { status: 200 }));
    }
    return new Promise((resolve) => {
      this.sent.push({
        query: url.searchParams,
        signal: request.signal,
        answer: (buckets, token) => {
          resolve(new Response(listAnswer(buckets, token), { status: 200 }));
        },
      });
    });
  };

  /** The n-th AWS request (from 0), once it has been sent. */
  async request(n: number): Promise<SentRequest> {
    await waitFor(() => {
      expect(this.sent.length).toBeGreaterThan(n);
    });
    return this.sent[n] as SentRequest;
  }
}

function listAnswer(names: string[], token?: string): string {
  const buckets = names.map((name) => `<Bucket><Name>${name}</Name></Bucket>`).join('');
  return `<ListAllMyBucketsResult><Buckets>${buckets}</Buckets>${
    token === undefined ? '' : `<ContinuationToken>${token}</ContinuationToken>`
  }</ListAllMyBucketsResult>`;
}

function names(count: number, from = 'b'): string[] {
  return Array.from({ length: count }, (_, index) => `${from}-${String(index + 1)}`);
}

let nextPort = 8700;
let engine: FakeEngine;
let endpoint: string;
let client: QueryClient;

beforeEach(() => {
  engine = new FakeEngine();
  vi.stubGlobal('fetch', engine.fetch);
  nextPort += 1;
  endpoint = engineEndpoint(nextPort);
  // As Studio's query client: nothing retried or refetched behind the screen's back.
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  client.clear();
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderListing(options: Partial<BucketListingOptions> = {}) {
  return renderHook((props: BucketListingOptions) => useBucketListing(props), {
    initialProps: { endpoint, pageSize: 25, filter: '', ...options },
    wrapper,
  });
}

describe('a listing', () => {
  it('asks for page 1 and gives nothing of an earlier listing while it is in flight', async () => {
    const { result } = renderListing();

    const first = await engine.request(0);
    expect(first.query.get('max-buckets')).toBe('25');
    expect(first.query.has('continuation-token')).toBe(false);
    expect(result.current.loading).toBe(true);
    expect(result.current.buckets).toBeUndefined();
    expect(result.current.count).toBeUndefined();

    act(() => {
      first.answer(['earlier-1', 'earlier-2']);
    });
    await waitFor(() => {
      expect(result.current.buckets?.map((b) => b.name)).toEqual(['earlier-1', 'earlier-2']);
    });

    act(() => {
      result.current.refresh();
    });
    const second = await engine.request(1);
    expect(second.query.has('continuation-token')).toBe(false);
    expect(result.current.loading).toBe(true);
    expect(result.current.buckets).toBeUndefined();
    expect(result.current.count).toBeUndefined();
    expect(result.current.currentPage).toBe(1);

    act(() => {
      second.answer(['later-1']);
    });
    await waitFor(() => {
      expect(result.current.buckets?.map((b) => b.name)).toEqual(['later-1']);
    });
    expect(result.current.count).toEqual({ total: 1, more: false });
  });

  it('asks the next page with the token of the page shown and counts the pages read, "+" while more remain', async () => {
    const { result } = renderListing({ pageSize: 2 });
    (await engine.request(0)).answer(names(2, 'p1'), 'token-after-1');
    await waitFor(() => {
      expect(result.current.count).toEqual({ total: 2, more: true });
    });
    expect(result.current.openEnd).toBe(true);

    act(() => {
      result.current.goToPage(2);
    });
    const second = await engine.request(1);
    expect(second.query.get('continuation-token')).toBe('token-after-1');
    expect(result.current.currentPage).toBe(2);
    act(() => {
      second.answer(names(2, 'p2'), 'token-after-2');
    });
    await waitFor(() => {
      expect(result.current.count).toEqual({ total: 4, more: true });
    });
    expect(result.current.buckets?.map((b) => b.name)).toEqual(['p2-1', 'p2-2']);

    act(() => {
      result.current.goToPage(3);
    });
    const third = await engine.request(2);
    expect(third.query.get('continuation-token')).toBe('token-after-2');
    act(() => {
      third.answer(names(1, 'p3'));
    });
    await waitFor(() => {
      expect(result.current.count).toEqual({ total: 5, more: false });
    });
    expect(result.current.openEnd).toBe(false);
    expect(result.current.pagesCount).toBe(3);
  });

  it('asks for page 1 again on the way back and counts it as last read', async () => {
    const { result } = renderListing({ pageSize: 2 });
    (await engine.request(0)).answer(names(2, 'p1'), 'token-after-1');
    await waitFor(() => {
      expect(result.current.count).toEqual({ total: 2, more: true });
    });
    act(() => {
      result.current.goToPage(2);
    });
    (await engine.request(1)).answer(names(1, 'p2'));
    await waitFor(() => {
      expect(result.current.count).toEqual({ total: 3, more: false });
    });

    act(() => {
      result.current.goToPage(1);
    });
    const again = await engine.request(2);
    expect(again.query.has('continuation-token')).toBe(false);
    expect(result.current.buckets).toBeUndefined();
    act(() => {
      // Page 1 now holds one bucket fewer: it counts as last read.
      again.answer(['p1-1'], 'token-after-1');
    });
    await waitFor(() => {
      expect(result.current.buckets?.map((b) => b.name)).toEqual(['p1-1']);
    });
    expect(result.current.count).toEqual({ total: 2, more: false });
    expect(result.current.currentPage).toBe(1);
  });

  it.each([
    [
      'a refresh',
      (listing: ReturnType<typeof renderListing>) => {
        act(() => {
          listing.result.current.refresh();
        });
      },
    ],
    [
      'a new filter',
      (listing: ReturnType<typeof renderListing>) => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        listing.rerender({ endpoint, pageSize: 2, filter: 'p' });
        act(() => {
          vi.advanceTimersByTime(FILTER_DELAY_MS);
        });
      },
    ],
    [
      'a new page size',
      (listing: ReturnType<typeof renderListing>) => {
        listing.rerender({ endpoint, pageSize: 10, filter: '' });
      },
    ],
  ])('starts a new listing at page 1 with its tokens dropped on %s', async (_, change) => {
    const listing = renderListing({ pageSize: 2 });
    const { result } = listing;
    (await engine.request(0)).answer(names(2, 'p1'), 'token-after-1');
    await waitFor(() => {
      expect(result.current.openEnd).toBe(true);
    });
    act(() => {
      result.current.goToPage(2);
    });
    (await engine.request(1)).answer(names(2, 'p2'), 'token-after-2');
    await waitFor(() => {
      expect(result.current.count).toEqual({ total: 4, more: true });
    });

    change(listing);

    const fresh = await engine.request(2);
    expect(fresh.query.has('continuation-token')).toBe(false);
    expect(result.current.currentPage).toBe(1);
    expect(result.current.count).toBeUndefined();
    act(() => {
      fresh.answer(['p1-1']);
    });
    await waitFor(() => {
      expect(result.current.count).toEqual({ total: 1, more: false });
    });
    expect(result.current.pagesCount).toBe(1);
    act(() => {
      result.current.goToPage(2);
    });
    expect(result.current.currentPage).toBe(1);
    expect(engine.sent).toHaveLength(3);
  });

  it('sends three characters typed within 300 ms as one prefix, 300 ms after the last', async () => {
    const listing = renderListing();
    (await engine.request(0)).answer(names(2));
    await waitFor(() => {
      expect(listing.result.current.buckets).toHaveLength(2);
    });
    vi.useFakeTimers();

    listing.rerender({ endpoint, pageSize: 25, filter: 'a' });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    listing.rerender({ endpoint, pageSize: 25, filter: 'ab' });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    listing.rerender({ endpoint, pageSize: 25, filter: 'abc' });
    act(() => {
      vi.advanceTimersByTime(FILTER_DELAY_MS - 1);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(engine.sent).toHaveLength(1);
    expect(listing.result.current.prefix).toBe('');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(listing.result.current.prefix).toBe('abc');
    vi.useRealTimers();
    const filtered = await engine.request(1);
    expect(filtered.query.get('prefix')).toBe('abc');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(engine.sent).toHaveLength(2);
  });

  it('keeps the newer answer when an older request answers after it', async () => {
    const { result } = renderListing();
    const older = await engine.request(0);
    act(() => {
      result.current.refresh();
    });
    const newer = await engine.request(1);

    act(() => {
      newer.answer(['newer']);
    });
    await waitFor(() => {
      expect(result.current.buckets?.map((b) => b.name)).toEqual(['newer']);
    });
    // The older request has been given up: no query waits for its answer any more.
    await waitFor(() => {
      expect(older.signal.aborted).toBe(true);
      expect(client.isFetching()).toBe(0);
    });
    expect(client.getQueryCache().findAll()).toHaveLength(1);
    await act(async () => {
      older.answer(['older']);
      await Promise.resolve();
    });

    expect(result.current.buckets?.map((b) => b.name)).toEqual(['newer']);
    expect(result.current.count).toEqual({ total: 1, more: false });
  });

  it('aborts the older request when a new listing starts while it is in flight', async () => {
    const { result } = renderListing();
    const older = await engine.request(0);
    expect(older.signal.aborted).toBe(false);

    act(() => {
      result.current.refresh();
    });
    const newer = await engine.request(1);

    await waitFor(() => {
      expect(older.signal.aborted).toBe(true);
    });
    expect(newer.signal.aborted).toBe(false);
  });

  it('asks for page 1 again after an unmount and a new mount, and shows nothing from before', async () => {
    const first = renderListing({ pageSize: 2 });
    (await engine.request(0)).answer(['before-1', 'before-2'], 'token-after-1');
    await waitFor(() => {
      expect(first.result.current.buckets).toHaveLength(2);
    });
    first.unmount();

    const second = renderListing({ pageSize: 2 });

    expect(second.result.current.buckets).toBeUndefined();
    expect(second.result.current.count).toBeUndefined();
    const again = await engine.request(1);
    expect(again.query.has('continuation-token')).toBe(false);
    expect(second.result.current.buckets).toBeUndefined();
    act(() => {
      again.answer(['after-1']);
    });
    await waitFor(() => {
      expect(second.result.current.buckets?.map((b) => b.name)).toEqual(['after-1']);
    });
  });
});
