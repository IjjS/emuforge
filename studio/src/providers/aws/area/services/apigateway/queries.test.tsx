import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import type { TokenPage } from '../../components/use-token-listing';
import { readRestApis, readV2Apis, type ApiRow } from './apis-api';
import {
  apiQueryKey,
  dropApi,
  dropApiLists,
  refreshApiLists,
  useApiLists,
  useAppendedPages,
  type AppendedPagesOptions,
} from './queries';

vi.mock('./apis-api', async (original) => ({
  ...(await original<typeof import('./apis-api')>()),
  readRestApis: vi.fn(),
  readV2Apis: vi.fn(),
}));

const endpoint = 'http://127.0.0.1:9681';
const operation = 'GetResources';
const failure = { kind: 'other', operation, code: 'InvalidPosition' } as const;
const firstPage = { items: ['/a'], next: 'position-2' };
const secondPage = { items: ['/b'] };
const key = [...apiQueryKey(endpoint, 'rest', 'api-1'), 'resources'];
const read = vi.fn<AppendedPagesOptions<string>['read']>();

let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.resetAllMocks();
});
afterEach(() => client.clear());

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function useResources() {
  return useAppendedPages({ key, endpoint, operation, read });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function api(id: string, kind: ApiRow['kind']): ApiRow {
  return { id, name: id, kind, createdDate: undefined, description: undefined, endpointTypes: [] };
}

it('appends a page in request order with the preceding page token', async () => {
  read.mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage);
  const { result } = renderHook(useResources, { wrapper });
  await waitFor(() => expect(result.current.items).toEqual(['/a']));
  expect(result.current.more).toBe(true);
  act(() => result.current.loadMore());
  await waitFor(() => expect(result.current.items).toEqual(['/a', '/b']));
  expect(result.current.more).toBe(false);
  expect(read).toHaveBeenNthCalledWith(1, endpoint, undefined, expect.any(AbortSignal));
  expect(read).toHaveBeenNthCalledWith(2, endpoint, 'position-2', expect.any(AbortSignal));
});

it('keeps successful pages when a further page fails and retries its token', async () => {
  read
    .mockResolvedValueOnce(firstPage)
    .mockRejectedValueOnce(new RequestError(failure))
    .mockResolvedValueOnce(secondPage);
  const { result } = renderHook(useResources, { wrapper });
  await waitFor(() => expect(result.current.more).toBe(true));
  act(() => result.current.loadMore());
  await waitFor(() => expect(result.current.failure).toEqual(failure));
  expect(result.current.items).toEqual(['/a']);
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.items).toEqual(['/a', '/b']));
  expect(result.current.failure).toBeUndefined();
  expect(read).toHaveBeenNthCalledWith(3, endpoint, 'position-2', expect.any(AbortSignal));
});

it('cancels a further page on refresh and discards its late answer', async () => {
  const further = deferred<TokenPage<string>>();
  read
    .mockResolvedValueOnce(firstPage)
    .mockReturnValueOnce(further.promise)
    .mockResolvedValueOnce({ items: ['/fresh'] });
  const { result } = renderHook(useResources, { wrapper });
  await waitFor(() => expect(result.current.more).toBe(true));
  act(() => result.current.loadMore());
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  act(() => {
    void result.current.refresh();
  });
  await waitFor(() => expect(result.current.items).toEqual(['/fresh']));
  expect(read.mock.calls[1]?.[2].aborted).toBe(true);
  expect(read).toHaveBeenNthCalledWith(3, endpoint, undefined, expect.any(AbortSignal));
  await act(async () => further.resolve(secondPage));
  expect(result.current.items).toEqual(['/fresh']);
});

it('uses only the second refresh when the first refresh answers last', async () => {
  const older = deferred<TokenPage<string>>();
  read
    .mockResolvedValueOnce(firstPage)
    .mockReturnValueOnce(older.promise)
    .mockResolvedValueOnce({ items: ['/latest'] });
  const { result } = renderHook(useResources, { wrapper });
  await waitFor(() => expect(result.current.more).toBe(true));
  act(() => {
    void result.current.refresh();
  });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  act(() => {
    void result.current.refresh();
  });
  await waitFor(() => expect(result.current.items).toEqual(['/latest']));
  expect(read.mock.calls[1]?.[2].aborted).toBe(true);
  await act(async () => older.resolve({ items: ['/outdated'] }));
  expect(result.current.items).toEqual(['/latest']);
});

it('drops both list caches and cancels the outstanding read before a fresh mount', async () => {
  const pending = deferred<TokenPage<ApiRow>>();
  vi.mocked(readRestApis)
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce({ items: [api('rest-new', 'REST')] });
  vi.mocked(readV2Apis)
    .mockResolvedValueOnce({ items: [api('v2-old', 'HTTP')] })
    .mockResolvedValueOnce({ items: [api('v2-new', 'HTTP')] });
  const first = renderHook(() => useApiLists(endpoint), { wrapper });
  await waitFor(() => expect(first.result.current.v2.items).toEqual([api('v2-old', 'HTTP')]));
  act(() => dropApiLists(client));
  expect(vi.mocked(readRestApis).mock.calls[0]?.[2].aborted).toBe(true);
  first.unmount();
  await act(async () => pending.resolve({ items: [api('rest-old', 'REST')] }));
  expect(client.getQueryCache().getAll()).toEqual([]);
  const next = renderHook(() => useApiLists(endpoint), { wrapper });
  expect(next.result.current.rest.items).toBeUndefined();
  expect(next.result.current.v2.items).toBeUndefined();
  await waitFor(() => {
    expect(next.result.current.rest.items).toEqual([api('rest-new', 'REST')]);
    expect(next.result.current.v2.items).toEqual([api('v2-new', 'HTTP')]);
  });
  for (const reader of [readRestApis, readV2Apis]) {
    expect(reader).toHaveBeenLastCalledWith(endpoint, undefined, expect.any(AbortSignal));
  }
});

it('drops every part of the named API, including a pending read, and keeps other IDs and models', async () => {
  const external = [...apiQueryKey(endpoint, 'rest', 'api-1'), 'stage-address', 'demo'];
  const detail = [...apiQueryKey(endpoint, 'rest', 'api-1'), 'detail'];
  const otherId = [...apiQueryKey(endpoint, 'rest', 'api-2'), 'detail'];
  const otherModel = [...apiQueryKey(endpoint, 'v2', 'api-1'), 'detail'];
  client.setQueryData(detail, 'one');
  client.setQueryData(otherId, 'two');
  client.setQueryData(otherModel, 'v2');
  const late = deferred<string>();
  const request = vi.fn(({ signal }: { signal: AbortSignal }) => {
    expect(signal.aborted).toBe(false);
    return late.promise;
  });
  const pending = client.fetchQuery({ queryKey: external, queryFn: request }).catch(() => undefined);
  await waitFor(() => expect(request).toHaveBeenCalledOnce());
  dropApi(client, 'rest', 'api-1');
  expect(request.mock.calls[0]?.[0].signal.aborted).toBe(true);
  late.resolve('outdated');
  await pending;
  expect(client.getQueryState(external)).toBeUndefined();
  expect(client.getQueryState(detail)).toBeUndefined();
  expect(client.getQueryData(otherId)).toBe('two');
  expect(client.getQueryData(otherModel)).toBe('v2');
});

it.each(['rest', 'v2'] as const)(
  'keeps both lists visible while post-delete first pages are pending, with an older %s page in flight',
  async (model) => {
    const rest = api('rest', 'REST');
    const extraRest = api('rest-page-2', 'REST');
    const v2 = api('http', 'HTTP');
    const extraV2 = api('ws-page-2', 'WebSocket');
    const oldPage = deferred<TokenPage<ApiRow>>();
    const newRest = deferred<TokenPage<ApiRow>>();
    const newV2 = deferred<TokenPage<ApiRow>>();
    vi.mocked(readRestApis)
      .mockResolvedValueOnce({ items: [rest], next: 'rest-2' })
      .mockResolvedValueOnce({ items: [extraRest], next: 'rest-3' });
    vi.mocked(readV2Apis)
      .mockResolvedValueOnce({ items: [v2], next: 'v2-2' })
      .mockResolvedValueOnce({ items: [extraV2], next: 'v2-3' });
    const reader = model === 'rest' ? readRestApis : readV2Apis;
    vi.mocked(reader).mockReturnValueOnce(oldPage.promise);
    vi.mocked(readRestApis).mockReturnValueOnce(newRest.promise);
    vi.mocked(readV2Apis).mockReturnValueOnce(newV2.promise);

    const { result } = renderHook(() => useApiLists(endpoint), { wrapper });
    await waitFor(() => {
      expect(result.current.rest.more).toBe(true);
      expect(result.current.v2.more).toBe(true);
    });
    act(() => {
      result.current.rest.loadMore();
      result.current.v2.loadMore();
    });
    await waitFor(() => {
      expect(result.current.rest.items).toEqual([rest, extraRest]);
      expect(result.current.v2.items).toEqual([v2, extraV2]);
    });
    act(() => result.current[model].loadMore());
    expect(reader).toHaveBeenNthCalledWith(3, endpoint, `${model}-3`, expect.any(AbortSignal));

    act(() => {
      const deleted = model === 'rest' ? rest : v2;
      void refreshApiLists(client, { endpoint, model, id: deleted.id });
    });
    await waitFor(() => {
      expect(result.current.rest.loading).toBe(true);
      expect(result.current.v2.loading).toBe(true);
      expect(result.current.rest.items).toEqual(model === 'rest' ? [extraRest] : [rest, extraRest]);
      expect(result.current.v2.items).toEqual(model === 'v2' ? [extraV2] : [v2, extraV2]);
    });
    expect(vi.mocked(reader).mock.calls[2]?.[2].aborted).toBe(true);
    expect(readRestApis).toHaveBeenLastCalledWith(endpoint, undefined, expect.any(AbortSignal));
    expect(readV2Apis).toHaveBeenLastCalledWith(endpoint, undefined, expect.any(AbortSignal));

    const refreshedRest = model === 'rest' ? [] : [rest];
    const refreshedV2 = model === 'v2' ? [] : [v2];
    await act(async () => {
      newRest.resolve({ items: refreshedRest, next: 'new-rest-token' });
      newV2.resolve({ items: refreshedV2, next: 'new-v2-token' });
    });
    await waitFor(() => {
      expect(result.current.rest.items).toEqual(refreshedRest);
      expect(result.current.v2.items).toEqual(refreshedV2);
    });
    await act(async () => oldPage.resolve({ items: [api('stale', 'REST')] }));
    expect(result.current.rest.items).toEqual(refreshedRest);
    expect(result.current.v2.items).toEqual(refreshedV2);
    expect(readRestApis).toHaveBeenCalledTimes(model === 'rest' ? 4 : 3);
    expect(readV2Apis).toHaveBeenCalledTimes(model === 'v2' ? 4 : 3);
  },
);

it.each(['rest', 'v2'] as const)(
  'keeps surviving %s rows while retrying only page one after a failed post-delete read',
  async (model) => {
    const deleted = api('deleted', model === 'rest' ? 'REST' : 'HTTP');
    const otherModel = api(deleted.id, model === 'rest' ? 'WebSocket' : 'REST');
    const firstSurvivor = api('first-survivor', deleted.kind);
    const laterSurvivor = api('later-survivor', deleted.kind);
    const retry = deferred<TokenPage<ApiRow>>();
    const readList = vi.mocked(model === 'rest' ? readRestApis : readV2Apis);
    const readOther = vi.mocked(model === 'rest' ? readV2Apis : readRestApis);
    readList
      .mockResolvedValueOnce({ items: [firstSurvivor], next: 'old-page-2' })
      .mockResolvedValueOnce({ items: [deleted, laterSurvivor], next: 'old-page-3' })
      .mockRejectedValueOnce(new RequestError(failure))
      .mockReturnValueOnce(retry.promise)
      .mockResolvedValueOnce({ items: [laterSurvivor] });
    readOther.mockResolvedValue({ items: [otherModel] });

    const { result } = renderHook(() => useApiLists(endpoint), { wrapper });
    await waitFor(() => expect(result.current[model].more).toBe(true));
    act(() => result.current[model].loadMore());
    await waitFor(() => expect(result.current[model].items).toEqual([firstSurvivor, deleted, laterSurvivor]));

    await act(async () => refreshApiLists(client, { endpoint, model, id: deleted.id }));
    await waitFor(() => expect(result.current[model].failure).toEqual(failure));
    expect(result.current[model].items).toEqual([firstSurvivor, laterSurvivor]);
    expect(result.current[model === 'rest' ? 'v2' : 'rest'].items).toEqual([otherModel]);
    expect(result.current[model].more).toBe(false);
    expect(readList).toHaveBeenNthCalledWith(3, endpoint, undefined, expect.any(AbortSignal));

    act(() => result.current[model].retry());
    await waitFor(() => expect(result.current[model].loading).toBe(true));
    expect(result.current[model].items).toEqual([firstSurvivor, laterSurvivor]);
    await act(async () => retry.resolve({ items: [firstSurvivor], next: 'new-page-2' }));
    await waitFor(() => expect(result.current[model].items).toEqual([firstSurvivor]));
    expect(result.current[model].failure).toBeUndefined();
    expect(readList).toHaveBeenCalledTimes(4);
    expect(readList).toHaveBeenLastCalledWith(endpoint, undefined, expect.any(AbortSignal));

    expect(result.current[model].more).toBe(true);
    act(() => result.current[model].loadMore());
    await waitFor(() => expect(result.current[model].items).toEqual([firstSurvivor, laterSurvivor]));
    expect(readList).toHaveBeenLastCalledWith(endpoint, 'new-page-2', expect.any(AbortSignal));
  },
);

it('reads both lists from their first pages on every mount without showing the preceding visit', async () => {
  const rest = api('old-rest', 'REST');
  const v2 = api('old-v2', 'HTTP');
  const nextRest = deferred<TokenPage<ApiRow>>();
  const nextV2 = deferred<TokenPage<ApiRow>>();
  vi.mocked(readRestApis)
    .mockResolvedValueOnce({ items: [rest] })
    .mockReturnValueOnce(nextRest.promise);
  vi.mocked(readV2Apis)
    .mockResolvedValueOnce({ items: [v2] })
    .mockReturnValueOnce(nextV2.promise);
  const first = renderHook(() => useApiLists(endpoint), { wrapper });
  await waitFor(() => {
    expect(first.result.current.rest.items).toEqual([rest]);
    expect(first.result.current.v2.items).toEqual([v2]);
  });
  first.unmount();
  const next = renderHook(() => useApiLists(endpoint), { wrapper });
  expect(next.result.current.rest.items).toBeUndefined();
  expect(next.result.current.v2.items).toBeUndefined();
  expect(readRestApis).toHaveBeenNthCalledWith(2, endpoint, undefined, expect.any(AbortSignal));
  expect(readV2Apis).toHaveBeenNthCalledWith(2, endpoint, undefined, expect.any(AbortSignal));
  await act(async () => {
    nextRest.resolve({ items: [] });
    nextV2.resolve({ items: [] });
  });
  await waitFor(() => {
    expect(next.result.current.rest.items).toEqual([]);
    expect(next.result.current.v2.items).toEqual([]);
  });
});
