import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ECS_KEYS } from './queries';
import * as api from './service-api';
import { useService, useServiceListing } from './service-queries';

// The hooks over `service-api.ts`, whose calls the case answers (`service-api.test.ts` proves the calls).

vi.mock('./service-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./service-api')>();
  return { ...real, listServices: vi.fn(), getService: vi.fn() };
});

const ENDPOINT = 'http://127.0.0.1:9996';

let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  client.clear();
  vi.useRealTimers();
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Whether `key` starts with `root`. */
function under(key: readonly unknown[], root: readonly unknown[]): boolean {
  return root.length <= key.length && root.every((part, index) => key[index] === part);
}

const keys = () =>
  client
    .getQueryCache()
    .getAll()
    .map((query) => query.queryKey);

const service = (name: string, running: number, desired = 2): api.Service => ({
  name,
  arn: `arn:aws:ecs:us-east-1:0:service/dev/${name}`,
  status: 'ACTIVE',
  desired,
  running,
  pending: 0,
  deployments: [],
  events: [],
});

describe('the keys', () => {
  it("the services key starts with the cluster's services root and holds the token; the service's key holds the name", async () => {
    vi.mocked(api.listServices).mockImplementation((_at, _cluster, token) =>
      Promise.resolve(token === undefined ? { services: [], nextToken: 'tok-1' } : { services: [] }),
    );
    vi.mocked(api.getService).mockResolvedValue({ found: true, service: service('api', 2) });
    const { result } = renderHook(
      () => ({ listing: useServiceListing(ENDPOINT, 'dev'), service: useService(ENDPOINT, 'dev', 'api') }),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.listing.openEnd).toBe(true);
    });
    act(() => {
      result.current.listing.goToPage(2);
    });
    await waitFor(() => {
      expect(api.listServices).toHaveBeenCalledTimes(2);
    });
    const root = ECS_KEYS.clusterServices('dev');
    expect(keys().some((key) => under(key, root) && key.includes('tok-1'))).toBe(true);
    await waitFor(() => {
      expect(result.current.service.value?.found).toBe(true);
    });
    expect(keys().some((key) => under(key, root) && key.includes('api'))).toBe(true);
  });
});

describe('following', () => {
  it('a page with a service running 1 of desired 2 → read again after 3 seconds; a settled page is not', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(api.listServices)
      .mockResolvedValueOnce({ services: [service('api', 2), service('web', 1)] })
      .mockResolvedValue({ services: [service('api', 2), service('web', 2)] });
    renderHook(() => useServiceListing(ENDPOINT, 'dev'), { wrapper });
    await waitFor(() => {
      expect(api.listServices).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_900);
    });
    expect(api.listServices).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await waitFor(() => {
      expect(api.listServices).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    expect(api.listServices).toHaveBeenCalledTimes(2);
  });

  it('the one service answering running 1 of desired 2 → read again after 3 seconds; a settled one is not', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(api.getService)
      .mockResolvedValueOnce({ found: true, service: service('api', 1) })
      .mockResolvedValue({ found: true, service: service('api', 2) });
    const { result } = renderHook(() => useService(ENDPOINT, 'dev', 'api'), { wrapper });
    await waitFor(() => {
      expect(result.current.value?.found).toBe(true);
    });
    expect(api.getService).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    await waitFor(() => {
      expect(api.getService).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    expect(api.getService).toHaveBeenCalledTimes(2);
  });
});
