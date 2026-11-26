import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';

import { getLogGroup, type LogGroupRead } from './api';
import { useLogGroup } from './queries';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  getLogGroup: vi.fn(),
}));

const endpoint = 'http://127.0.0.1:8306';

it.each([true, false])("shows the current name's answer when the earlier read settles first: %s", async (oldFirst) => {
  const old = deferred<LogGroupRead>();
  const current = deferred<LogGroupRead>();
  const oldGroup = { kind: 'found', group: { logGroupName: 'old' } } as const;
  const currentGroup = { kind: 'found', group: { logGroupName: 'current' } } as const;
  const read = vi.mocked(getLogGroup);
  read.mockReset().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const client = new QueryClient();
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  const { result, rerender } = renderHook(({ name }) => useLogGroup(endpoint, name), {
    initialProps: { name: 'old' },
    wrapper,
  });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  const oldSignal = read.mock.calls[0]?.[2];
  rerender({ name: 'current' });
  await waitFor(() => expect(read).toHaveBeenLastCalledWith(endpoint, 'current', expect.any(AbortSignal)));
  expect(oldSignal?.aborted).toBe(true);

  if (oldFirst) {
    await act(async () => old.resolve(oldGroup));
    expect(result.current.value).toBeUndefined();
  }
  await act(async () => current.resolve(currentGroup));
  await waitFor(() => expect(result.current.value).toEqual(currentGroup));
  if (!oldFirst) {
    await act(async () => old.resolve(oldGroup));
    expect(result.current.value).toEqual(currentGroup);
  }
});
