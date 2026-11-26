import { expect, it, vi } from 'vitest';

import { apiChoices } from './api-choices';
import { readRestApis, readV2Apis, type ApiRow } from './apis-api';

vi.mock('./apis-api', async (original) => ({
  ...(await original<typeof import('./apis-api')>()),
  readRestApis: vi.fn(),
  readV2Apis: vi.fn(),
}));

const endpoint = 'http://127.0.0.1:9681';
const rest: ApiRow = {
  id: 'rest-1',
  name: 'Orders',
  kind: 'REST',
  description: undefined,
  createdDate: undefined,
  endpointTypes: [],
};
const http: ApiRow = { ...rest, id: 'http-1', name: 'Events', kind: 'HTTP' };
const webSocket: ApiRow = { ...rest, id: 'ws-1', name: 'Updates', kind: 'WebSocket' };

it.each([
  ['rest', 'GetRestApis', readRestApis, rest, { value: 'rest-1', label: 'Orders', description: 'rest-1' }],
  ['v2', 'GetApis', readV2Apis, http, { value: 'http-1', label: 'Events', description: 'http-1 · HTTP' }],
  ['v2', 'GetApis', readV2Apis, webSocket, { value: 'ws-1', label: 'Updates', description: 'ws-1 · WebSocket' }],
] as const)('reads %s pages with %s and labels choices by name', async (model, operation, read, row, option) => {
  const signal = new AbortController().signal;
  const firstPage = { items: [row], next: 'next-api-page' };
  const lastPage = { items: [row] };
  vi.mocked(read).mockClear().mockResolvedValueOnce(firstPage).mockResolvedValueOnce(lastPage);

  const source = apiChoices(endpoint, model);
  expect(source.operation).toBe(operation);
  const first = await source.read(endpoint, '', undefined, signal);
  const last = await source.read(endpoint, '', first.next, signal);
  expect(first).toEqual(firstPage);
  expect(last).toEqual(lastPage);
  expect(read).toHaveBeenNthCalledWith(1, endpoint, undefined, signal);
  expect(read).toHaveBeenNthCalledWith(2, endpoint, 'next-api-page', signal);
  expect(first.items.map(source.optionOf)).toEqual([option]);
});
