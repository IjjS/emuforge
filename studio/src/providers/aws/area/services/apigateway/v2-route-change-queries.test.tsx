import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import { readRestApis, readV2Apis } from './apis-api';
import { useApiLists } from './queries';
import { getV2Api, readV2Integrations, readV2Routes } from './v2-api';
import { useV2Api, useV2Integrations, useV2Routes } from './v2-queries';
import { deleteV2Route, updateV2Api } from './v2-route-change-api';
import { useDeleteV2Route, useUpdateV2Api } from './v2-route-change-queries';

vi.mock('./apis-api', { spy: true });
vi.mock('./v2-api', { spy: true });
vi.mock('./v2-route-change-api', { spy: true });

const endpoint = 'http://127.0.0.1:9681';
const id = 'api-1';
const fields = { name: 'New', description: 'Changed' };
const apiRow = { id, kind: 'HTTP' as const, createdDate: undefined, endpointTypes: [] };
const restApis = vi.mocked(readRestApis);
const v2Apis = vi.mocked(readV2Apis);
const detail = vi.mocked(getV2Api);
const routes = vi.mocked(readV2Routes);
const integrations = vi.mocked(readV2Integrations);
let client: QueryClient;

beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient();
  restApis.mockResolvedValue({ items: [] });
  v2Apis.mockResolvedValue({ items: [{ ...apiRow, name: 'Old', description: '' }] });
  detail.mockResolvedValue({ found: true, api: { Name: 'Old' } });
  routes.mockResolvedValue({ items: [{ RouteId: 'r-1' }] });
  integrations.mockResolvedValue({ items: [{ IntegrationId: 'i-1' }] });
});

afterEach(() => client.clear());

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

it('refreshes the API and drops both API lists so the next opening reads the saved name', async () => {
  const lists = renderHook(() => useApiLists(endpoint), { wrapper });
  await waitFor(() => expect(lists.result.current.v2.items?.[0]?.name).toBe('Old'));
  const saved = vi.fn();
  const { result } = renderHook(() => ({ detail: useV2Api(endpoint, id), edit: useUpdateV2Api(endpoint, id, saved) }), {
    wrapper,
  });
  await waitFor(() => expect(result.current.detail.value).toMatchObject({ api: { Name: 'Old' } }));
  vi.mocked(updateV2Api).mockResolvedValue({ Name: fields.name, $metadata: {} });
  detail.mockResolvedValue({ found: true, api: { Name: fields.name, Description: fields.description } });
  v2Apis.mockResolvedValue({ items: [{ ...apiRow, ...fields }] });
  act(() => result.current.edit.submit(fields));
  await waitFor(() => expect(result.current.detail.value).toMatchObject({ api: { Name: fields.name } }));
  expect(saved).toHaveBeenCalledWith(fields.name);
  expect(client.getQueriesData({ queryKey: ['apigateway', 'lists'] })).toEqual([]);
  lists.unmount();

  const reopened = renderHook(() => useApiLists(endpoint), { wrapper });
  await waitFor(() => expect(reopened.result.current.v2.items?.[0]?.name).toBe(fields.name));
  expect(restApis).toHaveBeenCalledTimes(2);
  expect(v2Apis).toHaveBeenLastCalledWith(endpoint, undefined, expect.any(AbortSignal));
});

it.each([{ routeId: 'r-1' }, { routeId: 'r-1', integrationId: 'i-1' }])(
  'refreshes routes and integrations together after deleting %j',
  async (target) => {
    vi.mocked(deleteV2Route).mockResolvedValue(undefined);
    const deleted = vi.fn();
    const { result } = renderHook(
      () => ({
        routes: useV2Routes(endpoint, id),
        integrations: useV2Integrations(endpoint, id),
        remove: useDeleteV2Route(endpoint, id, deleted),
      }),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.routes.items).toHaveLength(1);
      expect(result.current.integrations.items).toHaveLength(1);
    });
    act(() => result.current.remove.submit(target));
    await waitFor(() => {
      expect(routes).toHaveBeenCalledTimes(2);
      expect(integrations).toHaveBeenCalledTimes(2);
    });
    expect(deleted).toHaveBeenCalledOnce();
  },
);

it('keeps the lists and detail reads when either change fails', async () => {
  vi.mocked(updateV2Api).mockRejectedValue(new RequestError({ kind: 'not-implemented', operation: 'UpdateApi' }));
  vi.mocked(deleteV2Route).mockRejectedValue(new RequestError({ kind: 'not-implemented', operation: 'DeleteRoute' }));
  const changed = vi.fn();
  const { result } = renderHook(
    () => ({
      lists: useApiLists(endpoint),
      detail: useV2Api(endpoint, id),
      routes: useV2Routes(endpoint, id),
      integrations: useV2Integrations(endpoint, id),
      edit: useUpdateV2Api(endpoint, id, changed),
      remove: useDeleteV2Route(endpoint, id, changed),
    }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.lists.v2.items).toBeDefined());
  act(() => {
    result.current.edit.submit(fields);
    result.current.remove.submit({ routeId: 'r-1' });
  });
  await waitFor(() => {
    expect(result.current.edit.failure?.operation).toBe('UpdateApi');
    expect(result.current.remove.failure?.operation).toBe('DeleteRoute');
  });
  expect(changed).not.toHaveBeenCalled();
  expect(client.getQueriesData({ queryKey: ['apigateway', 'lists'] })).toHaveLength(2);
  for (const read of [restApis, v2Apis, detail, routes, integrations]) expect(read).toHaveBeenCalledOnce();
});
