import type { TestInvokeMethodCommandOutput } from '@aws-sdk/client-api-gateway';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';

import { testInvokeMethod } from './test-api';
import { useTestMethod } from './test-queries';

vi.mock('./test-api', { spy: true });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('gives the latest test answer when the first test answers last', async () => {
  const first = deferred<TestInvokeMethodCommandOutput>();
  const second = deferred<TestInvokeMethodCommandOutput>();
  const invoke = vi.mocked(testInvokeMethod);
  invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const client = new QueryClient();
  const { result } = renderHook(() => useTestMethod('http://127.0.0.1:9682'), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  const input = { restApiId: 'api-1', resourceId: 'orders', httpMethod: 'GET' };
  act(() => result.current.submit({ ...input, pathWithQueryString: '/orders?test=first' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  act(() => result.current.submit({ ...input, pathWithQueryString: '/orders?test=second' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  await act(async () => second.resolve({ $metadata: {}, body: 'second' }));
  await waitFor(() => expect(client.isMutating()).toBe(1));
  await act(async () => first.resolve({ $metadata: {}, body: 'first' }));
  await waitFor(() => expect(client.isMutating()).toBe(0));
  expect(result.current.response?.body).toBe('second');
});
