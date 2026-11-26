import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import { deleteApi } from './api-delete-api';
import { readRestApis, readV2Apis, type ApiRow } from './apis-api';
import { useDeleteApi } from './api-delete-queries';
import { apiQueryKey, useApiLists } from './queries';

vi.mock('./api-delete-api', async (original) => ({
  ...(await original<typeof import('./api-delete-api')>()),
  deleteApi: vi.fn(),
}));

vi.mock('./apis-api', async (original) => ({
  ...(await original<typeof import('./apis-api')>()),
  readRestApis: vi.fn(),
  readV2Apis: vi.fn(),
}));

const endpoint = 'http://127.0.0.1:9681';
const target: ApiRow = {
  id: 'shared-id',
  kind: 'REST',
  name: 'Payroll',
  description: undefined,
  createdDate: undefined,
  endpointTypes: [],
};
const http: ApiRow = { ...target, kind: 'HTTP', name: 'Events' };
const detail = apiQueryKey(endpoint, 'rest', target.id);
const resources = [...detail, 'resources'];
const stages = [...detail, 'stages'];
const otherModel = apiQueryKey(endpoint, 'v2', target.id);
const onDeleted = vi.fn();

let client: QueryClient;

beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(detail, target);
  client.setQueryData(resources, ['/']);
  client.setQueryData(stages, ['local']);
  client.setQueryData(otherModel, http);
  vi.mocked(readRestApis)
    .mockResolvedValueOnce({ items: [target], next: 'position' })
    .mockResolvedValueOnce({ items: [{ ...target, id: 'rest-2' }] })
    .mockResolvedValueOnce({ items: [] });
  vi.mocked(readV2Apis)
    .mockResolvedValueOnce({ items: [http], next: 'token' })
    .mockResolvedValueOnce({ items: [{ ...http, id: 'http-2' }] })
    .mockResolvedValueOnce({ items: [http] });
});

afterEach(() => client.clear());

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function loadLists() {
  const lists = renderHook(() => useApiLists(endpoint), { wrapper });
  await waitFor(() => {
    expect(lists.result.current.rest.more).toBe(true);
    expect(lists.result.current.v2.more).toBe(true);
  });
  act(() => {
    lists.result.current.rest.loadMore();
    lists.result.current.v2.loadMore();
  });
  await waitFor(() => {
    expect(lists.result.current.rest.items).toHaveLength(2);
    expect(lists.result.current.v2.items).toHaveLength(2);
  });
  return lists;
}

it('refreshes both lists from page one and drops all cached reads of the deleted API', async () => {
  vi.mocked(deleteApi).mockResolvedValue(undefined);
  const lists = await loadLists();
  const { result } = renderHook(() => useDeleteApi(endpoint, onDeleted), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({ api: target, signal: new AbortController().signal });
  });

  await waitFor(() => {
    expect(lists.result.current.rest.items).toEqual([]);
    expect(lists.result.current.v2.items).toEqual([http]);
  });
  for (const reader of [readRestApis, readV2Apis]) {
    expect(reader).toHaveBeenCalledTimes(3);
    expect(reader).toHaveBeenLastCalledWith(endpoint, undefined, expect.any(AbortSignal));
  }
  expect(onDeleted).toHaveBeenCalledExactlyOnceWith(target);
  for (const key of [detail, resources, stages]) {
    expect(client.getQueryState(key)).toBeUndefined();
  }
  expect(client.getQueryData(otherModel)).toEqual(http);

  const readDetail = vi.fn().mockResolvedValue('API not found');
  const reopened = renderHook(() => useQuery({ queryKey: detail, queryFn: readDetail }), { wrapper });
  expect(reopened.result.current.data).toBeUndefined();
  await waitFor(() => expect(reopened.result.current.data).toBe('API not found'));
  expect(readDetail).toHaveBeenCalledOnce();
});

it('keeps the cached reads and skips the list refresh when the delete fails', async () => {
  const failure = new RequestError({ kind: 'access-denied', operation: 'DeleteRestApi', message: 'No access.' });
  vi.mocked(deleteApi).mockRejectedValue(failure);
  await loadLists();
  const { result } = renderHook(() => useDeleteApi(endpoint, onDeleted), { wrapper });
  await act(async () => {
    await expect(result.current.mutateAsync({ api: target, signal: new AbortController().signal })).rejects.toBe(
      failure,
    );
  });

  expect(readRestApis).toHaveBeenCalledTimes(2);
  expect(readV2Apis).toHaveBeenCalledTimes(2);
  expect(client.getQueryData(detail)).toEqual(target);
  expect(client.getQueryData(resources)).toEqual(['/']);
  expect(client.getQueryData(stages)).toEqual(['local']);
  expect(onDeleted).not.toHaveBeenCalled();
});
