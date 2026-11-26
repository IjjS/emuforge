import type { Resource, RestApi, Stage } from '@aws-sdk/client-api-gateway';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import type { TokenPage } from '../../components/use-token-listing';
import { readRestApi, readRestResources, readRestStages, readStageAddress } from './rest-api';
import {
  refreshRestApi,
  refreshRestResources,
  refreshRestStages,
  useRestApi,
  useRestResources,
  useRestStages,
  useStageAddress,
} from './rest-queries';

vi.mock('./rest-api', { spy: true });

const endpoint = 'http://127.0.0.1:9681';
const resources = vi.mocked(readRestResources);
const api = vi.mocked(readRestApi);
const stages = vi.mocked(readRestStages);
const address = vi.mocked(readStageAddress);
let client: QueryClient;

beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient();
});

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

function useReads(id: string) {
  return {
    api: useRestApi(id, endpoint),
    resources: useRestResources(id, endpoint),
    stages: useRestStages(id, endpoint),
    address: useStageAddress(id, 'dev', endpoint),
  };
}

it('refreshes resources to the first page and drops a late page from before the refresh', async () => {
  const further = deferred<TokenPage<Resource>>();
  const refreshed = deferred<TokenPage<Resource>>();
  const first = [{ path: '/' }];
  resources
    .mockResolvedValueOnce({ items: first, next: 'position' })
    .mockReturnValueOnce(further.promise)
    .mockReturnValueOnce(refreshed.promise);
  const { result } = renderHook(() => useRestResources('one', endpoint), { wrapper });
  await waitFor(() => expect(result.current.more).toBe(true));
  act(() => result.current.loadMore());
  await waitFor(() => expect(resources).toHaveBeenCalledTimes(2));
  act(() => {
    void refreshRestResources(client, 'one');
  });
  await waitFor(() => expect(resources).toHaveBeenCalledTimes(3));
  expect(result.current.items).toEqual(first);
  expect(resources.mock.calls[1]?.[3].aborted).toBe(true);
  expect(resources).toHaveBeenLastCalledWith(endpoint, 'one', undefined, expect.any(AbortSignal));
  await act(async () => refreshed.resolve({ items: [{ path: '/fresh' }] }));
  await waitFor(() => expect(result.current.items).toEqual([{ path: '/fresh' }]));
  await act(async () => further.resolve({ items: [{ path: '/late' }] }));
  expect(result.current.items).toEqual([{ path: '/fresh' }]);
});

it('refreshes the stages and their addresses, dropping both earlier reads that answer last', async () => {
  const olderStages = deferred<Stage[]>();
  const earlierAddress = deferred<string>();
  stages.mockReturnValueOnce(olderStages.promise).mockResolvedValueOnce([{ stageName: 'dev', deploymentId: 'new' }]);
  address.mockReturnValueOnce(earlierAddress.promise).mockResolvedValueOnce('https://127.0.0.1/new');
  const { result } = renderHook(
    () => ({
      stages: useRestStages('one', endpoint),
      address: useStageAddress('one', 'dev', endpoint),
    }),
    { wrapper },
  );
  await waitFor(() => expect(address).toHaveBeenCalledOnce());
  await act(async () => refreshRestStages(client, 'one'));
  await waitFor(() => {
    expect(result.current.stages.data?.[0]?.deploymentId).toBe('new');
    expect(result.current.address.data).toBe('https://127.0.0.1/new');
  });
  expect(stages.mock.calls[0]?.[2].aborted).toBe(true);
  expect(address.mock.calls[0]?.[3].aborted).toBe(true);
  await act(async () => {
    olderStages.resolve([{ stageName: 'old' }]);
    earlierAddress.resolve('https://127.0.0.1/old');
  });
  expect(result.current.stages.data?.[0]?.stageName).toBe('dev');
  expect(result.current.address.data).toBe('https://127.0.0.1/new');
});

it('keeps the new API response when a read started before refresh answers last', async () => {
  const older = deferred<RestApi>();
  api.mockReturnValueOnce(older.promise).mockResolvedValueOnce({ name: 'New' });
  const { result } = renderHook(() => useRestApi('one', endpoint), { wrapper });
  await waitFor(() => expect(api).toHaveBeenCalledOnce());
  await act(async () => refreshRestApi(client, 'one'));
  await waitFor(() => expect(result.current.data?.name).toBe('New'));
  expect(api.mock.calls[0]?.[2].aborted).toBe(true);
  await act(async () => older.resolve({ name: 'Old' }));
  expect(result.current.data?.name).toBe('New');
});

it('reads a new ID independently of data already shown for the previous ID', async () => {
  const nextApi = deferred<RestApi>();
  const nextResources = deferred<TokenPage<Resource>>();
  const nextStages = deferred<Stage[]>();
  const nextAddress = deferred<string>();
  api.mockResolvedValueOnce({ id: 'one' }).mockReturnValueOnce(nextApi.promise);
  resources.mockResolvedValueOnce({ items: [{ id: 'resource-one' }] }).mockReturnValueOnce(nextResources.promise);
  stages.mockResolvedValueOnce([{ stageName: 'dev', deploymentId: 'one' }]).mockReturnValueOnce(nextStages.promise);
  address.mockResolvedValueOnce('https://127.0.0.1/one').mockReturnValueOnce(nextAddress.promise);
  const { result, rerender } = renderHook(useReads, { wrapper, initialProps: 'one' });
  await waitFor(() => {
    expect(result.current.api.data?.id).toBe('one');
    expect(result.current.resources.items?.[0]?.id).toBe('resource-one');
    expect(result.current.stages.data?.[0]?.deploymentId).toBe('one');
    expect(result.current.address.data).toBe('https://127.0.0.1/one');
  });
  rerender('two');
  expect(result.current.api.data).toBeUndefined();
  expect(result.current.resources.items).toBeUndefined();
  expect(result.current.stages.data).toBeUndefined();
  expect(result.current.address.data).toBeUndefined();
  await act(async () => {
    nextApi.resolve({ id: 'two' });
    nextResources.resolve({ items: [{ id: 'resource-two' }] });
    nextStages.resolve([{ stageName: 'dev', deploymentId: 'two' }]);
    nextAddress.resolve('https://127.0.0.1/two');
  });
  await waitFor(() => {
    expect(result.current.api.data?.id).toBe('two');
    expect(result.current.resources.items?.[0]?.id).toBe('resource-two');
    expect(result.current.stages.data?.[0]?.deploymentId).toBe('two');
    expect(result.current.address.data).toBe('https://127.0.0.1/two');
  });
  expect(api).toHaveBeenLastCalledWith(endpoint, 'two', expect.any(AbortSignal));
  expect(resources).toHaveBeenLastCalledWith(endpoint, 'two', undefined, expect.any(AbortSignal));
  expect(stages).toHaveBeenLastCalledWith(endpoint, 'two', expect.any(AbortSignal));
  expect(address).toHaveBeenLastCalledWith(endpoint, 'two', 'dev', expect.any(AbortSignal));
});
