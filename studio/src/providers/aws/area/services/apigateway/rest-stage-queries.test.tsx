import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { readRestApi, readRestStages } from './rest-api';
import { useRestApi, useRestStages } from './rest-queries';
import { deleteRestStage, deployRestApi } from './rest-stage-api';
import { useDeleteRestStage, useDeployRestApi } from './rest-stage-queries';

vi.mock('./rest-api', { spy: true });
vi.mock('./rest-stage-api', { spy: true });

const endpoint = 'http://127.0.0.1:9681';
const id = 'api-1';
const stages = vi.mocked(readRestStages);
const details = vi.mocked(readRestApi);
const deploy = vi.mocked(deployRestApi);
const remove = vi.mocked(deleteRestStage);

beforeEach(() => {
  vi.resetAllMocks();
  stages.mockResolvedValue([{ stageName: 'dev', deploymentId: 'before' }]);
  details.mockResolvedValue({ id });
  deploy.mockResolvedValue(undefined);
  remove.mockResolvedValue(undefined);
});

async function open() {
  const client = new QueryClient();
  const onSuccess = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(
    () => ({
      stages: useRestStages(id, endpoint),
      details: useRestApi(id, endpoint),
      deploy: useDeployRestApi(id, endpoint, onSuccess),
      remove: useDeleteRestStage(id, endpoint, onSuccess),
    }),
    { wrapper },
  );

  await waitFor(() => {
    expect(result.current.stages.data).toEqual([{ stageName: 'dev', deploymentId: 'before' }]);
    expect(result.current.details.data).toEqual({ id });
  });
  return { result, onSuccess };
}

it.each(['deploy', 'delete'] as const)('refreshes stages after %s', async (action) => {
  const { result, onSuccess } = await open();
  const updated = action === 'deploy' ? [{ stageName: 'dev', deploymentId: 'after' }] : [];
  stages.mockResolvedValue(updated);
  await act(async () => {
    if (action === 'deploy') {
      await result.current.deploy.mutateAsync({ stageName: 'dev', description: '' });
    } else {
      await result.current.remove.mutateAsync('dev');
    }
  });
  await waitFor(() => {
    expect(result.current.stages.data).toEqual(updated);
  });
  expect(stages).toHaveBeenCalledTimes(2);
  expect(onSuccess).toHaveBeenCalledExactlyOnceWith('dev');
  expect(details).toHaveBeenCalledOnce();
});

it.each(['deploy', 'delete'] as const)('keeps the reads when %s is refused', async (action) => {
  const { result, onSuccess } = await open();
  const failure = new Error('Request refused');
  deploy.mockRejectedValue(failure);
  remove.mockRejectedValue(failure);
  await act(async () => {
    const request =
      action === 'deploy'
        ? result.current.deploy.mutateAsync({ stageName: 'dev', description: '' })
        : result.current.remove.mutateAsync('dev');
    await expect(request).rejects.toBe(failure);
  });
  expect(result.current.stages.data).toEqual([{ stageName: 'dev', deploymentId: 'before' }]);
  expect(onSuccess).not.toHaveBeenCalled();
  expect(stages).toHaveBeenCalledOnce();
  expect(details).toHaveBeenCalledOnce();
});
