import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { createRoute, type RouteOutcome } from './route-create-api';
import type { RouteInput } from './route-form';
import { useCreateRoute } from './route-queries';
import { refreshV2Routes } from './v2-queries';

vi.mock('./route-create-api', { spy: true });
vi.mock('./v2-queries', { spy: true });

beforeEach(() => vi.resetAllMocks());

const input: RouteInput = { key: 'GET /orders', authorization: 'NONE', integration: { kind: 'existing', id: 'int-1' } };
const failure = { operation: 'CreateRoute', kind: 'other', code: 'ConflictException' } as const;

it.each<{ outcome: RouteOutcome; refresh: boolean }>([
  { outcome: { kind: 'created' }, refresh: true },
  { outcome: { kind: 'created', permissionWarning: { functionName: 'orders', reason: 'Refused' } }, refresh: true },
  {
    outcome: {
      kind: 'left',
      failure,
      integrationId: 'int-new',
      removalFailure: { ...failure, operation: 'DeleteIntegration' },
    },
    refresh: true,
  },
  { outcome: { kind: 'unchanged', failure }, refresh: false },
  { outcome: { kind: 'removed', failure }, refresh: false },
])('refreshes the API routes and integrations for $outcome.kind (refresh = $refresh)', async ({ outcome, refresh }) => {
  const client = new QueryClient();
  vi.mocked(createRoute).mockResolvedValueOnce(outcome);
  vi.mocked(refreshV2Routes).mockResolvedValue(undefined);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const endpoint = 'http://127.0.0.1:9682';
  const { result } = renderHook(() => useCreateRoute('my-api', endpoint), { wrapper });
  const signal = new AbortController().signal;
  await act(async () => {
    await result.current.mutateAsync({ input, signal });
  });
  expect(createRoute).toHaveBeenCalledExactlyOnceWith(endpoint, 'my-api', input, signal);
  if (refresh) expect(refreshV2Routes).toHaveBeenCalledExactlyOnceWith(client, 'my-api');
  else expect(refreshV2Routes).not.toHaveBeenCalled();
});
