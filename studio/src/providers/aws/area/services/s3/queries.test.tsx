import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { NO_SUCH_BUCKET, NO_SUCH_KEY } from './api';
import { initialBucketForm } from './bucket-form';
import {
  FILTER_DELAY_MS,
  useBucketListing,
  useBucketLookup,
  useBucketProperty,
  useBucketToDelete,
  useChangeObjectVersion,
  useCreateBucket,
  useDeleteBucket,
  useEmptyingOperations,
  useObjectChanges,
  useObjectHead,
  useObjectListing,
  type BucketListingOptions,
  type ObjectListingOptions,
} from './queries';

// The test plays the engine behind the page's `fetch`. Each AWS request waits until the case answers it, so a case
// decides the order in which answers arrive.

interface SentRequest {
  url: URL;
  method: string;
  query: URLSearchParams;
  signal: AbortSignal;
  answer: (buckets: string[], token?: string) => void;
  /** Answers with this status and body; a 204 has no body. */
  respond: (status: number, body?: string) => void;
}

class FakeEngine {
  readonly sent: SentRequest[] = [];
  answerObjectRequest?: (request: Request, url: URL) => Response;

  readonly fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/__emuforge/session') {
      return Promise.resolve(new Response(JSON.stringify({ token: 'emuforge-test-token-56' }), { status: 200 }));
    }
    if (this.answerObjectRequest !== undefined) return Promise.resolve(this.answerObjectRequest(request, url));
    return new Promise((resolve) => {
      this.sent.push({
        url,
        method: request.method,
        query: url.searchParams,
        signal: request.signal,
        answer: (buckets, token) => {
          resolve(new Response(listAnswer(buckets, token), { status: 200 }));
        },
        respond: (status, body = '') => {
          resolve(new Response(status === 204 ? null : body, { status }));
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

it('rejects reusable null marker removal before transport', async () => {
  const transport = vi.fn(engine.fetch);
  vi.stubGlobal('fetch', transport);
  const { result } = renderHook(() => useChangeObjectVersion(endpoint, 'bucket'), { wrapper });
  await expect(
    result.current(
      { kind: 'delete-marker', key: 'key', versionId: 'null', latest: true },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ failure: { operation: 'DeleteObject', code: 'ReusableDeleteMarkerId' } });
  expect(transport).not.toHaveBeenCalled();
});

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

// Issue 256: the reads of a bucket's screens, and what an action makes stale.

function errorBody(code: string, message: string): string {
  return `<Error><Code>${code}</Code><Message>${message}</Message></Error>`;
}

/** The S3 reads the query client holds, by key. */
function s3Queries() {
  return client.getQueryCache().findAll({ queryKey: ['aws', 's3'] });
}

/** A `ListObjectsV2` answer of `keys` under `prefix`, truncated with `token` when one is given. */
function objectsAnswer(prefix: string, keys: string[], token?: string): string {
  const contents = keys.map((key) => `<Contents><Key>${key}</Key><Size>1</Size></Contents>`).join('');
  return (
    `<ListBucketResult><Name>alpha</Name><Prefix>${prefix}</Prefix><IsTruncated>${String(token !== undefined)}</IsTruncated>` +
    `${token === undefined ? '' : `<NextContinuationToken>${token}</NextContinuationToken>`}${contents}</ListBucketResult>`
  );
}

/** The keys of the objects the listing shows. */
function keysOf(page: ReturnType<typeof useObjectListing>['page']): string[] {
  return page === undefined || page === NO_SUCH_BUCKET ? [] : page.objects.map((object) => object.key);
}

function renderObjectListing(options: Partial<ObjectListingOptions> = {}) {
  return renderHook((props: ObjectListingOptions) => useObjectListing(props), {
    initialProps: { endpoint, bucket: 'alpha', prefix: '', filter: '', pageSize: 100, ...options },
    wrapper,
  });
}

describe('the objects listing', () => {
  it('has a key that holds the bucket, the prefix, the filter text, the page size and the token', async () => {
    const listing = renderObjectListing({ prefix: 'logs/', pageSize: 2 });
    (await engine.request(0)).respond(200, objectsAnswer('logs/', ['logs/a', 'logs/b'], 'next-1'));
    await waitFor(() => {
      expect(listing.result.current.openEnd).toBe(true);
    });
    act(() => {
      listing.result.current.goToPage(2);
    });
    const second = await engine.request(1);
    expect(second.query.get('continuation-token')).toBe('next-1');

    const key = s3Queries()
      .map((query) => query.queryKey)
      .find((queryKey) => queryKey.includes('next-1'));
    expect(key).toBeDefined();
    expect(key).toEqual(expect.arrayContaining(['alpha', 'logs/', '', 2, 'next-1']));

    listing.rerender({ endpoint, bucket: 'alpha', prefix: 'logs/', filter: 'b', pageSize: 2 });
    const filtered = await engine.request(2);
    expect(filtered.query.get('prefix')).toBe('logs/b');
    const filteredKey = s3Queries()
      .map((query) => query.queryKey)
      .find((queryKey) => queryKey.includes('b'));
    expect(filteredKey).toEqual(expect.arrayContaining(['alpha', 'logs/', 'b', 2]));
  });

  it('asks page 1 for a new prefix and for a new text', async () => {
    const listing = renderObjectListing({ pageSize: 2 });
    (await engine.request(0)).respond(200, objectsAnswer('', ['a', 'b'], 'next-1'));
    await waitFor(() => {
      expect(listing.result.current.openEnd).toBe(true);
    });
    act(() => {
      listing.result.current.goToPage(2);
    });
    expect((await engine.request(1)).query.get('continuation-token')).toBe('next-1');

    listing.rerender({ endpoint, bucket: 'alpha', prefix: 'logs/', filter: '', pageSize: 2 });
    const byPrefix = await engine.request(2);
    expect(byPrefix.query.get('prefix')).toBe('logs/');
    expect(byPrefix.query.has('continuation-token')).toBe(false);
    expect(listing.result.current.currentPage).toBe(1);
    byPrefix.respond(200, objectsAnswer('logs/', ['logs/a', 'logs/b'], 'next-2'));
    await waitFor(() => {
      expect(listing.result.current.openEnd).toBe(true);
    });
    act(() => {
      listing.result.current.goToPage(2);
    });
    expect((await engine.request(3)).query.get('continuation-token')).toBe('next-2');

    listing.rerender({ endpoint, bucket: 'alpha', prefix: 'logs/', filter: 'x', pageSize: 2 });
    const byText = await engine.request(4);
    expect(byText.query.get('prefix')).toBe('logs/x');
    expect(byText.query.has('continuation-token')).toBe(false);
    expect(listing.result.current.currentPage).toBe(1);
  });

  it('keeps the newer prefix’s answer when the older prefix answers after it', async () => {
    const listing = renderObjectListing({ prefix: 'old/' });
    const older = await engine.request(0);
    listing.rerender({ endpoint, bucket: 'alpha', prefix: 'new/', filter: '', pageSize: 100 });
    const newer = await engine.request(1);
    expect(newer.query.get('prefix')).toBe('new/');

    act(() => {
      newer.respond(200, objectsAnswer('new/', ['new/kept']));
    });
    await waitFor(() => {
      expect(keysOf(listing.result.current.page)).toEqual(['new/kept']);
    });
    await act(async () => {
      older.respond(200, objectsAnswer('old/', ['old/late']));
      await Promise.resolve();
    });

    expect(keysOf(listing.result.current.page)).toEqual(['new/kept']);
  });
});

describe('the reads of a bucket', () => {
  it('have keys that hold the bucket’s name, and two buckets never share a read', async () => {
    const { result } = renderHook(
      () => ({
        a: useBucketLookup(endpoint, 'bucket-a'),
        b: useBucketLookup(endpoint, 'bucket-b'),
        versioningA: useBucketProperty(endpoint, 'bucket-a', 'versioning', { generation: 0, enabled: true }),
        versioningB: useBucketProperty(endpoint, 'bucket-b', 'versioning', { generation: 0, enabled: true }),
      }),
      { wrapper },
    );
    await engine.request(3);

    const byPath = (path: string, versioning: boolean) =>
      engine.sent.find((sent) =>
        versioning ? sent.url.pathname.replace(/\/$/, '') === path : sent.query.get('prefix') === path.slice(1),
      ) as SentRequest;
    act(() => {
      byPath('/bucket-a', false).answer(['bucket-a']);
      byPath('/bucket-b', false).answer(['bucket-b']);
      byPath('/bucket-a', true).respond(
        200,
        '<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>',
      );
      byPath('/bucket-b', true).respond(200, '<VersioningConfiguration/>');
    });

    await waitFor(() => {
      expect(result.current.versioningB.value).toEqual({ status: 'Disabled' });
    });
    expect(result.current.a.value).toMatchObject({ name: 'bucket-a' });
    expect(result.current.b.value).toMatchObject({ name: 'bucket-b' });
    expect(result.current.versioningA.value).toEqual({ status: 'Enabled' });
    const keys = s3Queries().map((query) => query.queryKey);
    expect(keys).toHaveLength(4);
    for (const key of keys) {
      expect(key.filter((part) => part === 'bucket-a' || part === 'bucket-b')).toHaveLength(1);
    }
    expect(new Set(keys.map((key) => JSON.stringify(key))).size).toBe(4);
  });

  it('give a bucket the emulator does not hold as "no such bucket", and send no section’s read before it is enabled', async () => {
    const { result } = renderHook(
      () => {
        const lookup = useBucketLookup(endpoint, 'missing');
        const tags = useBucketProperty(endpoint, 'missing', 'tags', {
          generation: lookup.generation,
          enabled: lookup.value !== undefined && lookup.value !== NO_SUCH_BUCKET,
        });
        return { lookup, tags };
      },
      { wrapper },
    );

    act(() => {
      void engine.request(0).then((sent) => {
        sent.answer(['missing-but-longer']);
      });
    });
    await waitFor(() => {
      expect(result.current.lookup.value).toBe(NO_SUCH_BUCKET);
    });
    expect(engine.sent).toHaveLength(1);
    expect(result.current.tags.loading).toBe(false);
  });

  it('reads the delete page’s bucket, then whether it is empty with one key at most', async () => {
    const { result } = renderHook(() => useBucketToDelete(endpoint, 'full'), { wrapper });

    act(() => {
      void engine.request(0).then((sent) => {
        sent.answer(['full']);
      });
    });
    const versions = await engine.request(1);
    expect(versions.query.has('versions')).toBe(true);
    expect(versions.query.get('max-keys')).toBe('1');
    act(() => {
      versions.respond(
        200,
        '<ListVersionsResult><Version><Key>k</Key><VersionId>v</VersionId></Version></ListVersionsResult>',
      );
    });

    await waitFor(() => {
      expect(result.current.value).toMatchObject({ bucket: { name: 'full' }, empty: false });
    });
  });

  it('gives a section’s failure with the operation that was sent', async () => {
    const { result } = renderHook(() => useBucketProperty(endpoint, 'b', 'website', { generation: 0, enabled: true }), {
      wrapper,
    });

    act(() => {
      void engine.request(0).then((sent) => {
        sent.respond(400, errorBody('InvalidRequest', 'boom'));
      });
    });

    await waitFor(() => {
      expect(result.current.failure).toEqual({
        kind: 'other',
        operation: 'GetBucketWebsite',
        code: 'InvalidRequest',
        message: 'boom',
      });
    });
    expect(result.current.value).toBeUndefined();

    act(() => {
      result.current.again();
    });
    act(() => {
      void engine.request(1).then((sent) => {
        sent.respond(404, errorBody('NoSuchWebsiteConfiguration', 'none'));
      });
    });
    await waitFor(() => {
      expect(result.current.value).toEqual({ status: 'Disabled' });
    });
    expect(result.current.failure).toBeUndefined();
  });
});

describe('a read no longer wanted', () => {
  it('is aborted on "Refresh", and its late answer changes nothing shown', async () => {
    const { result } = renderHook(
      () => {
        const lookup = useBucketLookup(endpoint, 'b');
        const versioning = useBucketProperty(endpoint, 'b', 'versioning', {
          generation: lookup.generation,
          enabled: true,
        });
        return { lookup, versioning };
      },
      { wrapper },
    );
    const [olderLookup, olderVersioning] = [await engine.request(0), await engine.request(1)];

    act(() => {
      result.current.lookup.refresh();
    });
    const newer = [await engine.request(2), await engine.request(3)];
    expect(olderLookup.signal.aborted).toBe(true);
    expect(olderVersioning.signal.aborted).toBe(true);
    expect(result.current.lookup.loading).toBe(true);

    const newerLookup = newer.find((sent) => sent.query.has('prefix')) as SentRequest;
    const newerVersioning = newer.find((sent) => sent.query.has('versioning')) as SentRequest;
    act(() => {
      newerLookup.answer(['b']);
      newerVersioning.respond(200, '<VersioningConfiguration><Status>Suspended</Status></VersioningConfiguration>');
    });
    await waitFor(() => {
      expect(result.current.versioning.value).toEqual({ status: 'Suspended' });
    });

    act(() => {
      olderLookup.answer([]);
      olderVersioning.respond(200, '<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>');
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.lookup.value).toMatchObject({ name: 'b' });
    expect(result.current.versioning.value).toEqual({ status: 'Suspended' });
  });

  it('is aborted when the screen is left', async () => {
    const { unmount } = renderHook(() => useBucketToDelete(endpoint, 'b'), { wrapper });
    const sent = await engine.request(0);

    unmount();

    expect(sent.signal.aborted).toBe(true);
  });
});

describe('what an action makes stale', () => {
  /** Shows the list's and bucket `b`'s reads, answered, then runs `action`; returns what is held afterwards. */
  async function afterAction(action: (hooks: ReturnType<typeof useActions>) => Promise<unknown>, answer: () => void) {
    const shown = renderHook(
      () => ({
        list: useBucketListing({ endpoint, pageSize: 25, filter: '' }),
        lookup: useBucketLookup(endpoint, 'b'),
        tags: useBucketProperty(endpoint, 'b', 'tags', { generation: 0, enabled: true }),
        toDelete: useBucketToDelete(endpoint, 'b'),
      }),
      { wrapper },
    );
    const opening = await Promise.all([0, 1, 2, 3].map((n) => engine.request(n)));
    act(() => {
      for (const sent of opening) {
        if (sent.query.has('tagging')) {
          sent.respond(200, '<Tagging><TagSet><Tag><Key>k</Key><Value>v</Value></Tag></TagSet></Tagging>');
        } else {
          sent.answer(['b']);
        }
      }
    });
    await waitFor(() => {
      expect(shown.result.current.tags.value).toEqual([{ key: 'k', value: 'v' }]);
    });
    await waitFor(() => {
      expect(engine.sent.length).toBe(5);
    });
    act(() => {
      (engine.sent[4] as SentRequest).respond(200, '<ListVersionsResult></ListVersionsResult>');
    });
    await waitFor(() => {
      expect(shown.result.current.toDelete.value).toMatchObject({ empty: true });
    });

    const actions = renderHook(() => useActions(), { wrapper });
    const before = engine.sent.length;
    const running = action(actions.result.current);
    answer();
    await act(async () => {
      await running.catch(() => undefined);
    });
    const sentByAction = engine.sent.length - before;

    // Every S3 read still shown is stale, and none is fresh any more.
    expect(s3Queries().length).toBeGreaterThan(0);
    expect(s3Queries().every((query) => query.state.isInvalidated)).toBe(true);
    shown.unmount();
    actions.unmount();

    // Shown again: every read is sent again, and nothing is shown before its answer.
    const again = renderHook(
      () => ({
        list: useBucketListing({ endpoint, pageSize: 25, filter: '' }),
        lookup: useBucketLookup(endpoint, 'b'),
        tags: useBucketProperty(endpoint, 'b', 'tags', { generation: 0, enabled: true }),
      }),
      { wrapper },
    );
    const total = before + sentByAction;
    await waitFor(() => {
      expect(engine.sent.length).toBe(total + 3);
    });
    expect(again.result.current.list.buckets).toBeUndefined();
    expect(again.result.current.lookup.value).toBeUndefined();
    expect(again.result.current.tags.value).toBeUndefined();
    again.unmount();
  }

  function useActions() {
    return {
      create: useCreateBucket(endpoint),
      remove: useDeleteBucket(endpoint),
      emptying: useEmptyingOperations(endpoint, 'b'),
    };
  }

  const signal = () => new AbortController().signal;

  /** Answers the requests the action sends, from the n-th on, one by one as they come. */
  function answerFrom(n: number, answers: ((sent: SentRequest) => void)[]) {
    return () => {
      void (async () => {
        for (const [index, answer] of answers.entries()) {
          const sent = await engine.request(n + index);
          act(() => {
            answer(sent);
          });
        }
      })();
    };
  }

  it('drops them after a successful CreateBucket', async () => {
    await afterAction(
      ({ create }) => create({ ...initialBucketForm(), name: 'new-bucket' }, signal()),
      answerFrom(5, [(sent) => sent.answer([]), (sent) => sent.respond(200)]),
    );
  });

  it('drops them after a failed CreateBucket', async () => {
    await afterAction(
      ({ create }) => create({ ...initialBucketForm(), name: 'new-bucket' }, signal()),
      answerFrom(5, [(sent) => sent.answer([]), (sent) => sent.respond(400, errorBody('InvalidBucketName', 'bad'))]),
    );
  });

  it('drops them after a DeleteObjects', async () => {
    await afterAction(
      ({ emptying }) =>
        emptying?.deleteVersions([{ key: 'k', versionId: 'null' }], signal()) ??
        Promise.reject(new Error('no operations')),
      answerFrom(5, [(sent) => sent.respond(200, '<DeleteResult></DeleteResult>')]),
    );
  });

  it('drops them after a failed DeleteObjects', async () => {
    await afterAction(
      ({ emptying }) =>
        emptying?.deleteVersions([{ key: 'k', versionId: 'null' }], signal()) ??
        Promise.reject(new Error('no operations')),
      answerFrom(5, [(sent) => sent.respond(400, errorBody('MalformedXML', 'boom'))]),
    );
  });

  it('drops them after a DeleteBucket, whatever it answered', async () => {
    await afterAction(({ remove }) => remove('b', signal()), answerFrom(5, [(sent) => sent.respond(204)]));
  });

  it('drops them after a DeleteBucket answered "bucket not empty"', async () => {
    await afterAction(
      ({ remove }) => remove('b', signal()),
      answerFrom(5, [(sent) => sent.respond(409, errorBody('BucketNotEmpty', 'not empty'))]),
    );
  });
});

describe('readback after object changes', () => {
  const original = { bucket: 'alpha', key: 'original' };
  const destination = { bucket: 'alpha', key: 'copy' };
  const addresses = {
    original: '/alpha/original',
  };

  function useObjectReads(copyBucket: string) {
    return {
      original: useObjectHead(endpoint, original.bucket, original.key),
      destination: useObjectHead(endpoint, copyBucket, destination.key),
      originalBucket: useObjectListing({ endpoint, bucket: original.bucket, prefix: '', filter: '', pageSize: 100 }),
      destinationBucket: useObjectListing({ endpoint, bucket: copyBucket, prefix: '', filter: '', pageSize: 100 }),
    };
  }

  beforeEach(() => {
    const stored = new Map<string, Record<string, string>>([
      [addresses.original, { 'content-type': 'text/plain', 'x-amz-meta-phase': 'before' }],
    ]);
    engine.answerObjectRequest = (request, url) => {
      const address = decodeURIComponent(url.pathname);
      switch (request.method) {
        case 'HEAD': {
          const headers = stored.get(address);
          return headers === undefined ? new Response(null, { status: 404 }) : new Response(null, { headers });
        }
        case 'PUT': {
          const source = stored.get('/' + decodeURIComponent(request.headers.get('x-amz-copy-source') ?? ''));
          if (source === undefined) return new Response(errorBody('NoSuchKey', 'Missing source'), { status: 404 });
          const headers =
            request.headers.get('x-amz-metadata-directive') === 'REPLACE'
              ? Object.fromEntries(
                  [...request.headers].filter(([name]) => name === 'content-type' || name.startsWith('x-amz-meta-')),
                )
              : source;
          stored.set(address, headers);
          return new Response('<CopyObjectResult><ETag>"copy"</ETag></CopyObjectResult>');
        }
        case 'DELETE':
          if (denyDelete) {
            return new Response(errorBody('AccessDenied', 'Deletion was refused'), { status: 403 });
          }
          stored.delete(address);
          return new Response(null, { status: 204 });
        default: {
          if (url.searchParams.get('x-id') === 'ListBuckets') {
            return new Response(listAnswer([url.searchParams.get('prefix') ?? '']));
          }
          const bucketPrefix = address.endsWith('/') ? address : address + '/';
          return new Response(
            objectsAnswer(
              '',
              [...stored.keys()]
                .filter((key) => key.startsWith(bucketPrefix))
                .map((key) => key.slice(bucketPrefix.length)),
            ),
          );
        }
      }
    };
    denyDelete = false;
  });
  let denyDelete: boolean;

  it.each([
    {
      action: 'copy across buckets',
      bucket: 'beta',
      deleteSource: false,
      denied: false,
      originalKeys: ['original'],
      destinationKeys: ['copy'],
    },
    {
      action: 'rename',
      bucket: 'alpha',
      deleteSource: true,
      denied: false,
      originalKeys: ['copy'],
      destinationKeys: ['copy'],
    },
    {
      action: 'rename with a refused deletion',
      bucket: 'alpha',
      deleteSource: true,
      denied: true,
      originalKeys: ['original', 'copy'],
      destinationKeys: ['original', 'copy'],
    },
  ])(
    'reads the actual details and listings again after $action',
    async ({ bucket, deleteSource, denied, originalKeys, destinationKeys }) => {
      denyDelete = denied;
      const reads = renderHook(() => useObjectReads(bucket), { wrapper });
      const writing = renderHook(() => useObjectChanges(endpoint), { wrapper });
      await waitFor(() => {
        expect(reads.result.current.original.value).toMatchObject({ key: 'original' });
        expect(reads.result.current.destination.value).toBe(NO_SUCH_KEY);
        expect(keysOf(reads.result.current.originalBucket.page)).toEqual(['original']);
        expect(keysOf(reads.result.current.destinationBucket.page)).toEqual(bucket === 'alpha' ? ['original'] : []);
      });

      const changes = writing.result.current;
      if (changes === undefined) throw new Error('Expected object changes for the engine');
      const signal = new AbortController().signal;
      await act(async () => {
        await changes.copy(original, { ...destination, bucket }, signal);
        if (deleteSource) {
          const deleting = changes.removeSource(original, signal);
          if (denied) await expect(deleting).rejects.toMatchObject({ failure: { kind: 'access-denied' } });
          else await deleting;
        }
      });
      expect(
        s3Queries().some(
          (query) => query.queryKey.slice(2, 4).join('/') === `objects/${bucket}` && query.state.isInvalidated,
        ),
      ).toBe(true);
      expect(
        s3Queries().some(
          (query) =>
            query.queryKey.slice(2, 7).join('/') === `bucket/${bucket}/object/copy/head` && query.state.isInvalidated,
        ),
      ).toBe(true);
      reads.unmount();

      const reopened = renderHook(() => useObjectReads(bucket), { wrapper });
      await waitFor(() => {
        if (deleteSource && !denied) expect(reopened.result.current.original.value).toBe(NO_SUCH_KEY);
        else expect(reopened.result.current.original.value).toMatchObject({ key: 'original' });
        expect(reopened.result.current.destination.value).toMatchObject({
          key: 'copy',
          contentType: 'text/plain',
          user: [{ key: 'phase', value: 'before' }],
        });
        expect(keysOf(reopened.result.current.originalBucket.page)).toEqual(originalKeys);
        expect(keysOf(reopened.result.current.destinationBucket.page)).toEqual(destinationKeys);
      });
    },
  );

  it('reopens the edited object with its stored content type and metadata', async () => {
    const read = renderHook(() => useObjectHead(endpoint, original.bucket, original.key), { wrapper });
    const writing = renderHook(() => useObjectChanges(endpoint), { wrapper });
    await waitFor(() =>
      expect(read.result.current.value).toMatchObject({
        contentType: 'text/plain',
        user: [{ key: 'phase', value: 'before' }],
      }),
    );
    const changes = writing.result.current;
    if (changes === undefined) throw new Error('Expected object changes for the engine');
    await act(() =>
      changes.copy(original, original, new AbortController().signal, {
        edit: { contentType: 'application/json', metadata: { phase: 'after' }, headers: undefined },
      }),
    );
    expect(s3Queries().some((query) => query.state.isInvalidated)).toBe(true);
    read.unmount();

    const reopened = renderHook(() => useObjectHead(endpoint, original.bucket, original.key), { wrapper });
    await waitFor(() =>
      expect(reopened.result.current.value).toMatchObject({
        key: original.key,
        contentType: 'application/json',
        user: [{ key: 'phase', value: 'after' }],
      }),
    );
  });
});
