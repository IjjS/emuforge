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
