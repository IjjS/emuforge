import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { getV2Api, readV2Integrations, readV2Routes, readV2Stages } from './v2-api';
import { useV2Api, useV2Integrations, useV2Routes, useV2Stages } from './v2-queries';
import { createV2Stage, deleteV2Stage, deployV2Stage } from './v2-stage-api';
import { useCreateV2Stage, useDeleteV2Stage, useDeployV2Stage } from './v2-stage-queries';

vi.mock('./v2-api', { spy: true });
vi.mock('./v2-stage-api', { spy: true });

const endpoint = 'http://127.0.0.1:9681';
const id = 'api-1';
const stages = vi.mocked(readV2Stages);
const api = vi.mocked(getV2Api);
const routes = vi.mocked(readV2Routes);
const integrations = vi.mocked(readV2Integrations);
const create = vi.mocked(createV2Stage);
const deploy = vi.mocked(deployV2Stage);
const remove = vi.mocked(deleteV2Stage);
const present = { StageName: 'dev', AutoDeploy: false };
const actions = ['create', 'deploy', 'delete'] as const;

beforeEach(() => {
  vi.resetAllMocks();
  stages.mockResolvedValue({ items: [present] });
  api.mockResolvedValue({ found: true, api: { ApiId: id } });
  routes.mockResolvedValue({ items: [] });
  integrations.mockResolvedValue({ items: [] });
  create.mockResolvedValue(undefined);
  deploy.mockResolvedValue(undefined);
  remove.mockResolvedValue(undefined);
});

async function open() {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(
    () => ({
      stages: useV2Stages(endpoint, id),
      api: useV2Api(endpoint, id),
      routes: useV2Routes(endpoint, id),
      integrations: useV2Integrations(endpoint, id),
      create: useCreateV2Stage(id, endpoint),
      deploy: useDeployV2Stage(id, endpoint),
      delete: useDeleteV2Stage(id, endpoint),
    }),
    { wrapper },
  );

  await waitFor(() => {
    expect(result.current.stages.items).toEqual([present]);
    expect(result.current.api.value).toEqual({ found: true, api: { ApiId: id } });
    expect(result.current.routes.items).toEqual([]);
    expect(result.current.integrations.items).toEqual([]);
  });

  function submit(action: (typeof actions)[number], success: () => void) {
    act(() => {
      if (action === 'create') result.current.create.submit({ stageName: 'test', autoDeploy: true }, success);
      else result.current[action].submit('dev', success);
    });
  }

  return { result, submit };
}

it.each(actions)('refreshes only the stages after %s succeeds', async (action) => {
  const { result, submit } = await open();
  const updated = {
    create: [present, { StageName: 'test', AutoDeploy: true }],
    deploy: [{ ...present, DeploymentId: 'd-1' }],
    delete: [],
  }[action];
  stages.mockResolvedValueOnce({ items: updated });
  const success = vi.fn();

  submit(action, success);

  await waitFor(() => expect(result.current.stages.items).toEqual(updated));
  expect(success).toHaveBeenCalledOnce();
  expect(stages).toHaveBeenCalledTimes(2);
  expect(api).toHaveBeenCalledOnce();
  expect(routes).toHaveBeenCalledOnce();
  expect(integrations).toHaveBeenCalledOnce();
});

it.each(actions)('does not refresh any reads after %s fails', async (action) => {
  const { result, submit } = await open();
  const request = { create, deploy, delete: remove }[action];
  request.mockRejectedValueOnce(new Error('Request refused'));
  const success = vi.fn();

  submit(action, success);

  await waitFor(() => expect(result.current[action].failure).toMatchObject({ kind: 'other' }));
  expect(success).not.toHaveBeenCalled();
  expect(stages).toHaveBeenCalledOnce();
  expect(api).toHaveBeenCalledOnce();
  expect(routes).toHaveBeenCalledOnce();
  expect(integrations).toHaveBeenCalledOnce();
});
