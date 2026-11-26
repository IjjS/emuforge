import type { Integration, Route, Stage } from '@aws-sdk/client-apigatewayv2';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { TokenPage } from '../../components/use-token-listing';
import { getV2Api, readV2Integrations, readV2Routes, readV2Stages, type V2ApiRead } from './v2-api';
import {
  refreshV2Api,
  refreshV2Routes,
  refreshV2Stages,
  useV2Api,
  useV2Integrations,
  useV2Routes,
  useV2Stages,
} from './v2-queries';

vi.mock('./v2-api', async (original) => ({
  ...(await original<typeof import('./v2-api')>()),
  getV2Api: vi.fn(),
  readV2Routes: vi.fn(),
  readV2Integrations: vi.fn(),
  readV2Stages: vi.fn(),
}));

const endpoint = 'http://127.0.0.1:9684';
const apiId = 'api-1';
const getApi = vi.mocked(getV2Api);
const getRoutes = vi.mocked(readV2Routes);
const getIntegrations = vi.mocked(readV2Integrations);
const getStages = vi.mocked(readV2Stages);
let client: QueryClient;

beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient();
});

afterEach(() => client.clear());

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function api(id: string): V2ApiRead {
  return { found: true, api: { ApiId: id, Name: id, ProtocolType: 'HTTP' } };
}

it('refreshes routes and integrations together from the first page and discards later answers from aborted reads', async () => {
  const oldRoutes = deferred<TokenPage<Route>>();
  const oldIntegrations = deferred<TokenPage<Integration>>();
  getRoutes
    .mockResolvedValueOnce({ items: [{ RouteKey: 'GET /initial' }], next: 'routes-next' })
    .mockReturnValueOnce(oldRoutes.promise)
    .mockResolvedValueOnce({ items: [{ RouteKey: 'GET /fresh' }] });
  getIntegrations
    .mockResolvedValueOnce({ items: [{ IntegrationId: 'initial' }], next: 'integrations-next' })
    .mockReturnValueOnce(oldIntegrations.promise)
    .mockResolvedValueOnce({ items: [{ IntegrationId: 'fresh' }] });

  const { result } = renderHook(
    () => ({
      routes: useV2Routes(endpoint, apiId),
      integrations: useV2Integrations(endpoint, apiId),
    }),
    { wrapper },
  );
  await waitFor(() => {
    expect(result.current.routes.more).toBe(true);
    expect(result.current.integrations.more).toBe(true);
  });
  act(() => {
    result.current.routes.loadMore();
    result.current.integrations.loadMore();
  });
  await waitFor(() => {
    expect(getRoutes).toHaveBeenNthCalledWith(2, endpoint, apiId, 'routes-next', expect.any(AbortSignal));
    expect(getIntegrations).toHaveBeenNthCalledWith(2, endpoint, apiId, 'integrations-next', expect.any(AbortSignal));
  });

  await act(async () => refreshV2Routes(client, apiId));
  for (const read of [getRoutes, getIntegrations]) {
    expect(read.mock.calls[1]?.[3].aborted).toBe(true);
    expect(read).toHaveBeenNthCalledWith(3, endpoint, apiId, undefined, expect.any(AbortSignal));
  }
  await act(async () => {
    oldRoutes.resolve({ items: [{ RouteKey: 'GET /stale' }] });
    oldIntegrations.resolve({ items: [{ IntegrationId: 'stale' }] });
  });
  await waitFor(() => {
    expect(result.current.routes.items).toEqual([{ RouteKey: 'GET /fresh' }]);
    expect(result.current.integrations.items).toEqual([{ IntegrationId: 'fresh' }]);
  });
});

it('refreshes stages and the API while their first reads are pending and discards the aborted results', async () => {
  const oldApi = deferred<V2ApiRead>();
  const oldStages = deferred<TokenPage<Stage>>();
  getApi.mockReturnValueOnce(oldApi.promise).mockResolvedValueOnce(api('fresh'));
  getStages.mockReturnValueOnce(oldStages.promise).mockResolvedValueOnce({ items: [{ StageName: 'fresh' }] });
  const { result } = renderHook(
    () => ({
      api: useV2Api(endpoint, apiId),
      stages: useV2Stages(endpoint, apiId),
    }),
    { wrapper },
  );

  await waitFor(() => {
    expect(getApi).toHaveBeenCalledOnce();
    expect(getStages).toHaveBeenCalledOnce();
  });
  await act(async () => {
    await Promise.all([refreshV2Api(client, apiId), refreshV2Stages(client, apiId)]);
  });
  expect(getApi.mock.calls[0]?.[2].aborted).toBe(true);
  expect(getStages.mock.calls[0]?.[3].aborted).toBe(true);
  expect(getStages).toHaveBeenNthCalledWith(2, endpoint, apiId, undefined, expect.any(AbortSignal));
  await act(async () => {
    oldApi.resolve(api('old'));
    oldStages.resolve({ items: [{ StageName: 'old' }] });
  });
  await waitFor(() => {
    expect(result.current.api.value).toEqual(api('fresh'));
    expect(result.current.stages.items).toEqual([{ StageName: 'fresh' }]);
  });
});

it('starts all four reads for another ID without sharing an answer from the first ID', async () => {
  getApi.mockImplementation(async (_, id) => api(id));
  getRoutes.mockImplementation(async (_, id) => ({ items: [{ RouteKey: id }] }));
  getIntegrations.mockImplementation(async (_, id) => ({ items: [{ IntegrationId: id }] }));
  getStages.mockImplementation(async (_, id) => ({ items: [{ StageName: id }] }));

  const { result, rerender } = renderHook(
    ({ id }) => ({
      api: useV2Api(endpoint, id),
      routes: useV2Routes(endpoint, id),
      integrations: useV2Integrations(endpoint, id),
      stages: useV2Stages(endpoint, id),
    }),
    { wrapper, initialProps: { id: apiId } },
  );

  const expectId = (id: string) => {
    expect(result.current.api.value).toEqual(api(id));
    expect(result.current.routes.items).toEqual([{ RouteKey: id }]);
    expect(result.current.integrations.items).toEqual([{ IntegrationId: id }]);
    expect(result.current.stages.items).toEqual([{ StageName: id }]);
  };
  await waitFor(() => expectId(apiId));
  rerender({ id: 'api-2' });
  expect(result.current.api.value).toBeUndefined();
  expect(result.current.routes.items).toBeUndefined();
  expect(result.current.integrations.items).toBeUndefined();
  expect(result.current.stages.items).toBeUndefined();
  await waitFor(() => expectId('api-2'));
});
