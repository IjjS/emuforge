import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import { readRestApis, readV2Apis } from './apis-api';
import { useApiLists } from './queries';
import { readRestApi, readRestResources } from './rest-api';
import { createResource, deleteMethod, deleteResource, updateRestApi } from './rest-change-api';
import { useCreateResource, useDeleteMethod, useDeleteResource, useUpdateRestApi } from './rest-change-queries';
import { useRestApi, useRestResources } from './rest-queries';

vi.mock('./apis-api', { spy: true });
vi.mock('./rest-api', { spy: true });
vi.mock('./rest-change-api', { spy: true });

const endpoint = 'http://127.0.0.1:9681';
const id = 'api-1';
const previous = { name: 'Old', description: '' };
const next = { name: 'New', description: 'Changed' };
const apiRow = { id, kind: 'REST' as const, createdDate: undefined, endpointTypes: [] };
const restApis = vi.mocked(readRestApis);
const v2Apis = vi.mocked(readV2Apis);
const readApi = vi.mocked(readRestApi);
const resources = vi.mocked(readRestResources);
let client: QueryClient;

beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient();
  restApis.mockResolvedValue({ items: [{ ...apiRow, ...previous }] });
  v2Apis.mockResolvedValue({ items: [] });
  readApi.mockResolvedValue(previous);
  resources.mockResolvedValue({ items: [{ path: '/' }] });
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

it('refreshes the edited API and drops the API lists so their next read shows the new name', async () => {
  const lists = renderHook(() => useApiLists(endpoint), { wrapper });
  await waitFor(() => expect(lists.result.current.rest.items?.[0]?.name).toBe('Old'));
  await waitFor(() => expect(lists.result.current.v2.items).toEqual([]));
  const onSaved = vi.fn();
  const { result } = renderHook(
    () => ({
      detail: useRestApi(id, endpoint),
      change: useUpdateRestApi(endpoint, id, previous, onSaved),
    }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.detail.data?.name).toBe('Old'));
  vi.mocked(updateRestApi).mockResolvedValue({ ...next, $metadata: {} });
  readApi.mockResolvedValue(next);
  restApis.mockResolvedValue({ items: [{ ...apiRow, ...next }] });
  act(() => result.current.change.submit(next));
  await waitFor(() => expect(result.current.detail.data?.name).toBe('New'));
  expect(onSaved).toHaveBeenCalledWith('New');
  expect(client.getQueriesData({ queryKey: ['apigateway', 'lists'] })).toEqual([]);
  lists.unmount();

  const reopened = renderHook(() => useApiLists(endpoint), { wrapper });
  await waitFor(() => expect(reopened.result.current.rest.items?.[0]?.name).toBe('New'));
  expect(v2Apis).toHaveBeenCalledTimes(2);
  expect(restApis).toHaveBeenLastCalledWith(endpoint, undefined, expect.any(AbortSignal));
});

it('refreshes the resources after each resource or method change', async () => {
  vi.mocked(createResource).mockResolvedValue({ path: '/orders', $metadata: {} });
  vi.mocked(deleteResource).mockResolvedValue({ $metadata: {} });
  vi.mocked(deleteMethod).mockResolvedValue({ $metadata: {} });
  const changed = vi.fn();
  const { result } = renderHook(
    () => ({
      list: useRestResources(id, endpoint),
      create: useCreateResource(endpoint, id, changed),
      remove: useDeleteResource(endpoint, id, changed),
      removeMethod: useDeleteMethod(endpoint, id, changed),
    }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.list.items).toEqual([{ path: '/' }]));
  const parent = { parentId: 'root', parentPath: '/', pathPart: 'orders' };
  for (const submit of [
    () => result.current.create.submit(parent),
    () => result.current.removeMethod.submit({ resourceId: 'orders', method: 'GET' }),
    () => result.current.remove.submit('orders'),
  ]) {
    const expectedReads = resources.mock.calls.length + 1;
    act(submit);
    await waitFor(() => expect(resources).toHaveBeenCalledTimes(expectedReads));
    expect(resources).toHaveBeenLastCalledWith(endpoint, id, undefined, expect.any(AbortSignal));
  }
  expect(changed).toHaveBeenCalledTimes(3);
});

it('keeps the existing lists and reads when changes fail', async () => {
  const failure = new RequestError({ kind: 'other', operation: 'UpdateRestApi', code: 'BadRequestException' });
  vi.mocked(updateRestApi).mockRejectedValue(failure);
  vi.mocked(createResource).mockRejectedValue(failure);
  vi.mocked(deleteResource).mockRejectedValue(failure);
  vi.mocked(deleteMethod).mockRejectedValue(failure);
  const changed = vi.fn();
  const { result } = renderHook(
    () => ({
      lists: useApiLists(endpoint),
      detail: useRestApi(id, endpoint),
      resources: useRestResources(id, endpoint),
      edit: useUpdateRestApi(endpoint, id, previous, changed),
      create: useCreateResource(endpoint, id, changed),
      remove: useDeleteResource(endpoint, id, changed),
      removeMethod: useDeleteMethod(endpoint, id, changed),
    }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.lists.rest.items).toBeDefined());
  act(() => {
    result.current.edit.submit(next);
    result.current.create.submit({ parentId: 'root', parentPath: '/', pathPart: 'orders' });
    result.current.remove.submit('orders');
    result.current.removeMethod.submit({ resourceId: 'orders', method: 'GET' });
  });
  await waitFor(() => {
    for (const change of [
      result.current.edit,
      result.current.create,
      result.current.remove,
      result.current.removeMethod,
    ]) {
      expect(change.failure?.kind).toBe('other');
    }
  });
  expect(changed).not.toHaveBeenCalled();
  expect(client.getQueriesData({ queryKey: ['apigateway', 'lists'] })).toHaveLength(2);
  for (const read of [restApis, v2Apis, readApi, resources]) expect(read).toHaveBeenCalledOnce();
});
