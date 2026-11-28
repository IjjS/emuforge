import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import { listInternetGateways, type InternetGateway, type Page } from './api';
import { useFreeVpcs } from './use-free-vpcs';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  listInternetGateways: vi.fn(),
}));

const endpoint = 'http://127.0.0.1:9966';
const oldAttachment = { id: 'igw-old', vpcId: 'vpc-old', tags: [] };
const newAttachment = { id: 'igw-new', vpcId: 'vpc-new', tags: [] };
const oldMap = new Map([['vpc-old', 'igw-old']]);
const newMap = new Map([['vpc-new', 'igw-new']]);
const read = vi.mocked(listInternetGateways);

function open() {
  const client = new QueryClient();
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useFreeVpcs(endpoint), { wrapper });
}

function holdNextRead() {
  let resolve: (page: Page<InternetGateway>) => void = () => undefined;
  read.mockReturnValueOnce(
    new Promise((answer) => {
      resolve = answer;
    }),
  );
  return { resolve };
}

beforeEach(() => {
  read.mockReset();
});

describe('VPC gateway occupancy', () => {
  it('starts without a map and reads all gateway pages before publishing attachments', async () => {
    const first = holdNextRead();
    const second = holdNextRead();
    const { result } = open();
    expect(result.current.checking).toBe(true);
    expect(result.current.attachments).toBeUndefined();
    act(() => first.resolve({ items: [{ id: 'igw-detached', tags: [] }], nextToken: 'page-2' }));
    await waitFor(() => expect(read).toHaveBeenLastCalledWith(endpoint, {}, 'page-2', expect.any(AbortSignal)));
    expect(result.current.attachments).toBeUndefined();
    act(() => second.resolve({ items: [oldAttachment] }));
    await waitFor(() => expect(result.current.attachments).toEqual(oldMap));
    expect(result.current.checking).toBe(false);
  });

  it('holds the old map back while a refresh is in flight', async () => {
    read.mockResolvedValueOnce({ items: [oldAttachment] });
    const second = holdNextRead();
    const { result } = open();
    await waitFor(() => expect(result.current.attachments).toEqual(oldMap));
    act(() => result.current.refresh());
    expect(result.current.checking).toBe(true);
    expect(result.current.attachments).toBeUndefined();
    act(() => second.resolve({ items: [newAttachment] }));
    await waitFor(() => expect(result.current.attachments).toEqual(newMap));
  });

  it("keeps the newer read's answer when the older one arrives last", async () => {
    const first = holdNextRead();
    const second = holdNextRead();
    const { result } = open();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    act(() => result.current.refresh());
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    act(() => second.resolve({ items: [newAttachment] }));
    await waitFor(() => expect(result.current.attachments).toEqual(newMap));
    await act(async () => first.resolve({ items: [oldAttachment] }));
    expect(result.current.attachments).toEqual(newMap);
  });

  it('exposes a failed read with no map and reads again on retry', async () => {
    const failure = { kind: 'other', operation: 'DescribeInternetGateways', code: 'InternalError' } as const;
    read.mockRejectedValueOnce(new RequestError(failure)).mockResolvedValueOnce({ items: [newAttachment] });
    const { result } = open();
    await waitFor(() => expect(result.current.failure).toEqual(failure));
    expect(result.current.attachments).toBeUndefined();
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.attachments).toEqual(newMap));
    expect(result.current.failure).toBeUndefined();
  });
});
