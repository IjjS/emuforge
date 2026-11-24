import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';

import * as api from './api';
import { modifyInstanceAttribute } from './instance-attribute-api';
import { useInstanceAttributeChange } from './instance-attribute-queries';
import { useInstance, useInstanceListing, useTerminationProtection } from './queries';

vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  getInstance: vi.fn(),
  listInstances: vi.fn(),
  getTerminationProtection: vi.fn(),
}));

vi.mock('./instance-attribute-api', async (original) => ({
  ...(await original<typeof import('./instance-attribute-api')>()),
  modifyInstanceAttribute: vi.fn(),
}));

it('refreshes the matching instance, protection and list after a save', async () => {
  const endpoint = 'http://127.0.0.1:8397';
  const initial: api.Instance = {
    id: 'i-target',
    state: 'running',
    type: 't3.micro',
    groups: [],
    volumes: [],
    tags: [],
  };
  const updated = { ...initial, type: 't3.small' };
  vi.mocked(api.getInstance)
    .mockResolvedValueOnce({ found: true, instance: initial })
    .mockResolvedValueOnce({ found: true, instance: updated });
  vi.mocked(api.listInstances)
    .mockResolvedValueOnce({ instances: [initial] })
    .mockResolvedValueOnce({ instances: [updated] });
  vi.mocked(api.getTerminationProtection).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  vi.mocked(modifyInstanceAttribute).mockResolvedValue(undefined);
  const client = new QueryClient();
  const { result } = renderHook(
    () => ({
      detail: useInstance(endpoint, initial.id),
      protection: useTerminationProtection(endpoint, initial.id),
      list: useInstanceListing(endpoint, { state: 'running', name: '' }),
      save: useInstanceAttributeChange(endpoint, initial.id),
    }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );

  await waitFor(() => {
    expect(result.current.detail.value).toEqual({ found: true, instance: initial });
    expect(result.current.protection.value).toBe(false);
    expect(result.current.list.items).toEqual([initial]);
  });
  await act(() => result.current.save({ kind: 'protection', enabled: true }, new AbortController().signal));
  await waitFor(() => {
    expect(result.current.detail.value).toEqual({ found: true, instance: updated });
    expect(result.current.protection.value).toBe(true);
    expect(result.current.list.items).toEqual([updated]);
  });
});
