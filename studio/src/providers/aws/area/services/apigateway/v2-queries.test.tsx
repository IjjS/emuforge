import type { Integration, Route, Stage } from '@aws-sdk/client-apigatewayv2';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi, type MockedFunction } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import type { TokenPage } from '../../components/use-token-listing';
import {
  GET_INTEGRATIONS,
  GET_ROUTES,
  GET_STAGES,
  getV2Api,
  readV2Integrations,
  readV2Routes,
  readV2Stages,
  type V2ApiRead,
} from './v2-api';
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
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
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

function pagesAfterDelete<T>(
  read: MockedFunction<
    (origin: string, id: string, token: string | undefined, signal: AbortSignal) => Promise<TokenPage<T>>
  >,
  operation: string,
  row: (id: string) => T,
) {
  const first = row('first');
  const deleted = row('deleted');
  const later = row('later');
  const refresh = deferred<TokenPage<T>>();
  const retry = deferred<TokenPage<T>>();
  const failure = { kind: 'other', operation, code: 'BadRequestException' } as const;
  read
    .mockResolvedValueOnce({ items: [first], next: 'old-page-2' })
    .mockResolvedValueOnce({ items: [deleted, later], next: 'old-page-3' })
    .mockReturnValueOnce(refresh.promise)
    .mockReturnValueOnce(retry.promise)
    .mockResolvedValueOnce({ items: [later] });

  return {
    read,
    failure,
    initial: [first, deleted, later],
    remaining: [first, later],
    firstPage: [first],
    fail: () => refresh.reject(new RequestError(failure)),
    recover: () => retry.resolve({ items: [first], next: 'new-page-2' }),
  };
}

it.each([true, false])(
  'recovers v2 lists from a failed post-delete read (integration deleted: %s)',
  async (integrationDeleted) => {
    const routes = pagesAfterDelete(getRoutes, GET_ROUTES, (id) => ({ RouteId: id }));
    const integrations = pagesAfterDelete(getIntegrations, GET_INTEGRATIONS, (id) => ({ IntegrationId: id }));
    const stages = pagesAfterDelete(getStages, GET_STAGES, (id) => ({ StageName: id }));

    const { result } = renderHook(
      () => ({
        routes: useV2Routes(endpoint, apiId),
        integrations: useV2Integrations(endpoint, apiId),
        stages: useV2Stages(endpoint, apiId),
      }),
      { wrapper },
    );
    const lists = () => [
      { list: result.current.routes, pages: routes, remaining: routes.remaining },
      {
        list: result.current.integrations,
        pages: integrations,
        remaining: integrationDeleted ? integrations.remaining : integrations.initial,
      },
      { list: result.current.stages, pages: stages, remaining: stages.remaining },
    ];
    await waitFor(() => {
      for (const { list } of lists()) expect(list.more).toBe(true);
    });
    act(() => {
      for (const { list } of lists()) list.loadMore();
    });
    await waitFor(() => {
      for (const { list, pages } of lists()) expect(list.items).toEqual(pages.initial);
    });

    act(() => {
      void refreshV2Routes(client, apiId, {
        endpoint,
        routeId: 'deleted',
        ...(integrationDeleted ? { integrationId: 'deleted' } : {}),
      });
      void refreshV2Stages(client, apiId, { endpoint, stageName: 'deleted' });
    });
    await waitFor(() => {
      for (const { list, pages, remaining } of lists()) {
        expect(list.loading).toBe(true);
        expect(list.items).toEqual(remaining);
        expect(pages.read).toHaveBeenNthCalledWith(3, endpoint, apiId, undefined, expect.any(AbortSignal));
      }
    });
    await act(async () => {
      for (const { pages } of lists()) pages.fail();
    });
    await waitFor(() => {
      for (const { list, pages, remaining } of lists()) {
        expect(list.failure).toEqual(pages.failure);
        expect(list.items).toEqual(remaining);
        expect(list.more).toBe(false);
      }
    });

    act(() => {
      for (const { list } of lists()) list.retry();
    });
    await waitFor(() => {
      for (const { list, remaining } of lists()) {
        expect(list.loading).toBe(true);
        expect(list.items).toEqual(remaining);
      }
    });
    await act(async () => {
      for (const { pages } of lists()) pages.recover();
    });
    await waitFor(() => {
      for (const { list, pages } of lists()) {
        expect(list.items).toEqual(pages.firstPage);
        expect(list.failure).toBeUndefined();
        expect(list.more).toBe(true);
        expect(pages.read).toHaveBeenCalledTimes(4);
        expect(pages.read).toHaveBeenLastCalledWith(endpoint, apiId, undefined, expect.any(AbortSignal));
      }
    });
    act(() => {
      for (const { list } of lists()) list.loadMore();
    });
    await waitFor(() => {
      for (const { list, pages } of lists()) {
        expect(list.items).toEqual(pages.remaining);
        expect(pages.read).toHaveBeenLastCalledWith(endpoint, apiId, 'new-page-2', expect.any(AbortSignal));
      }
    });
  },
);

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
