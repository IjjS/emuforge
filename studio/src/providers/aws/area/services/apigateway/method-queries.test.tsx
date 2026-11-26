import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { createMethod, type MethodOutcome } from './method-create-api';
import type { MethodInput } from './method-form';
import { useCreateMethod } from './method-queries';
import { refreshRestResources } from './rest-queries';

vi.mock('./method-create-api', { spy: true });
vi.mock('./rest-queries', { spy: true });

beforeEach(() => vi.resetAllMocks());

const input: MethodInput = {
  resource: { id: 'root', path: '/' },
  method: 'GET',
  authorization: 'NONE',
  apiKeyRequired: false,
  integration: { kind: 'mock', body: '{}' },
};

it.each<{ outcome: MethodOutcome; refresh: boolean }>([
  { outcome: { kind: 'created' }, refresh: true },
  {
    outcome: { kind: 'created', permissionWarning: { functionName: 'orders', reason: 'No permission' } },
    refresh: true,
  },
  {
    outcome: { kind: 'unchanged', failure: { operation: 'PutMethod', kind: 'other', code: 'ConflictException' } },
    refresh: false,
  },
  {
    outcome: { kind: 'removed', failure: { operation: 'PutIntegration', kind: 'other', code: 'BadRequestException' } },
    refresh: false,
  },
])('refreshes changed resources for $outcome.kind (refresh = $refresh)', async ({ outcome, refresh }) => {
  const client = new QueryClient();
  vi.mocked(createMethod).mockResolvedValueOnce(outcome);
  vi.mocked(refreshRestResources).mockResolvedValue(undefined);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const endpoint = 'http://127.0.0.1:9682';
  const { result } = renderHook(() => useCreateMethod('my-api', endpoint), { wrapper });
  const signal = new AbortController().signal;
  await act(async () => {
    await result.current.mutateAsync({ input, signal });
  });
  expect(createMethod).toHaveBeenCalledExactlyOnceWith(endpoint, 'my-api', input, signal);
  if (refresh) expect(refreshRestResources).toHaveBeenCalledExactlyOnceWith(client, 'my-api');
  else expect(refreshRestResources).not.toHaveBeenCalled();
});
