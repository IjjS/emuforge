import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import { createApi, type CreatedApi } from './api-create-api';
import { useCreateApi } from './api-create-queries';
import { readRestApis, readV2Apis, type ApiRow } from './apis-api';
import { useApiLists } from './queries';

vi.mock('./api-create-api', () => ({ createApi: vi.fn() }));
vi.mock('./apis-api', async (original) => ({
  ...(await original<typeof import('./apis-api')>()),
  readRestApis: vi.fn(),
  readV2Apis: vi.fn(),
}));

const endpoint = 'http://127.0.0.1:9683';
const input = { kind: 'HTTP', name: 'Fresh API', description: '', defaultStage: 'create' } as const;
const created: CreatedApi = { kind: 'HTTP', id: 'fresh', name: input.name };
const stageFailure = { kind: 'other', operation: 'CreateStage', code: 'BadRequest', message: 'Stage refused' } as const;
const failure = { kind: 'other', operation: 'CreateApi', code: 'BadRequest', message: 'API refused' } as const;
let client: QueryClient;

beforeEach(() => {
  client = new QueryClient();
  vi.resetAllMocks();
});

afterEach(() => client.clear());

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

it.each(['created', 'stage refused', 'API refused'] as const)(
  'sends one in-flight request and delivers one outcome (%s)',
  async (resultKind) => {
    let resolve!: (value: CreatedApi) => void;
    let reject!: (reason: RequestError) => void;
    const pending = new Promise<CreatedApi>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    vi.mocked(createApi).mockReturnValue(pending);
    const { result } = renderHook(() => useCreateApi(endpoint), { wrapper });

    const first = result.current.submit(input);
    const second = result.current.submit(input);
    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(await second).toBeUndefined();
    expect(createApi).toHaveBeenCalledTimes(1);

    await act(async () => {
      if (resultKind === 'API refused') {
        reject(new RequestError(failure));
        expect(await first).toEqual({ failure });
      } else {
        const api = resultKind === 'stage refused' ? { ...created, stageFailure } : created;
        resolve(api);
        expect(await first).toEqual({ created: api });
      }
    });
  },
);

function api(id: string, kind: ApiRow['kind']): ApiRow {
  return { id, name: id, kind, description: undefined, createdDate: undefined, endpointTypes: [] };
}

it.each([true, false])('drops both lists’ saved pages only after creation (%s)', async (succeeds) => {
  const oldRest = api('rest', 'REST');
  const oldHttp = api('http', 'HTTP');
  const secondPage = api('more', 'HTTP');
  const fresh = api(created.id, 'HTTP');
  vi.mocked(readRestApis).mockResolvedValue({ items: [oldRest] });
  vi.mocked(readV2Apis)
    .mockResolvedValueOnce({ items: [oldHttp], next: 'next' })
    .mockResolvedValueOnce({ items: [secondPage] })
    .mockResolvedValue({ items: [oldHttp, fresh] });
  const lists = renderHook(() => useApiLists(endpoint), { wrapper });
  await waitFor(() => expect(lists.result.current.v2.more).toBe(true));
  act(() => lists.result.current.v2.loadMore());
  await waitFor(() => expect(lists.result.current.v2.items).toEqual([oldHttp, secondPage]));
  const saved = client
    .getQueryCache()
    .getAll()
    .map((query) => query.queryKey);
  expect(saved).toHaveLength(2);
  const { result } = renderHook(() => useCreateApi(endpoint), { wrapper });

  if (succeeds) vi.mocked(createApi).mockResolvedValue({ ...created, stageFailure });
  else vi.mocked(createApi).mockRejectedValue(new RequestError(failure));
  await act(async () => {
    await result.current.submit(input);
  });

  for (const key of saved) {
    if (succeeds) expect(client.getQueryState(key)).toBeUndefined();
    else expect(client.getQueryState(key)?.status).toBe('success');
  }
  expect(readV2Apis).toHaveBeenCalledTimes(2);
  if (!succeeds) return;

  lists.unmount();
  const reopened = renderHook(() => useApiLists(endpoint), { wrapper });
  await waitFor(() => expect(reopened.result.current.v2.items).toEqual([oldHttp, fresh]));
  expect(readV2Apis).toHaveBeenLastCalledWith(endpoint, undefined, expect.any(AbortSignal));
  expect(readRestApis).toHaveBeenCalledTimes(2);
});
