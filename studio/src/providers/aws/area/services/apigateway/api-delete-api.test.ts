import { DeleteRestApiCommand } from '@aws-sdk/client-api-gateway';
import { DeleteApiCommand } from '@aws-sdk/client-apigatewayv2';
import { beforeEach, expect, it, vi } from 'vitest';

import { deleteApi } from './api-delete-api';
import { sendRest, sendV2 } from './clients';
import type { ApiKind } from './format';

vi.mock('./clients');

const endpoint = 'http://127.0.0.1:9681';
const send = vi.fn().mockResolvedValue({});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sendRest).mockImplementation((_endpoint, _operation, run, signal) => run({ send } as never, signal));
  vi.mocked(sendV2).mockImplementation((_endpoint, _operation, run, signal) => run({ send } as never, signal));
});

it.each([
  ['REST', sendRest, sendV2, 'DeleteRestApi', DeleteRestApiCommand, { restApiId: 'api-1' }],
  ['HTTP', sendV2, sendRest, 'DeleteApi', DeleteApiCommand, { ApiId: 'api-1' }],
  ['WebSocket', sendV2, sendRest, 'DeleteApi', DeleteApiCommand, { ApiId: 'api-1' }],
] as const)('deletes a %s API by ID', async (kind: ApiKind, sendModel, other, operation, Command, input) => {
  const signal = new AbortController().signal;
  await deleteApi(endpoint, { id: 'api-1', name: 'Local API', kind }, signal);
  expect(sendModel).toHaveBeenCalledWith(endpoint, operation, expect.any(Function), signal);
  expect(other).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledExactlyOnceWith(expect.any(Command), { abortSignal: signal });
  expect(send.mock.calls[0]?.[0]).toMatchObject({ input });
});
