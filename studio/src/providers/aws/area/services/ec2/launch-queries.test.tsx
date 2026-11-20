import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import * as api from './launch-api';
import { useLaunchInstance } from './launch-queries';
import { EC2_KEYS } from './queries';

// The launch hook over `launch-api.ts`, whose call the case answers (`launch-api.test.ts` proves the call).

vi.mock('./launch-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./launch-api')>();
  return { ...real, launchInstance: vi.fn() };
});

const ENDPOINT = 'http://127.0.0.1:9996';
const LAUNCH: api.NewInstance = { imageId: 'ami-1', instanceType: 't3.micro' };

let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useLaunchInstance', () => {
  it('after a launch succeeds → the instance lists are read again; after it fails → none is', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useLaunchInstance(ENDPOINT), { wrapper });
    const signal = new AbortController().signal;

    vi.mocked(api.launchInstance).mockResolvedValueOnce('i-0new');
    await expect(result.current(LAUNCH, signal)).resolves.toBe('i-0new');
    expect(api.launchInstance).toHaveBeenCalledWith(ENDPOINT, LAUNCH, signal);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: EC2_KEYS.instances() });

    invalidate.mockClear();
    const refusal = new RequestError({ kind: 'other', operation: 'RunInstances', code: 'Unsupported', message: 'no' });
    vi.mocked(api.launchInstance).mockRejectedValueOnce(refusal);
    await expect(result.current(LAUNCH, signal)).rejects.toBe(refusal);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
