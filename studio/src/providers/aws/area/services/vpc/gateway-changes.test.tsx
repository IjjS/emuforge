import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import * as api from './gateway-changes-api';
import { useAttachGateway, useCreateGateway, useDeleteGateway, useDetachGateway } from './gateway-changes';
import { VPC_KEYS } from './queries';

// The mutations over `gateway-changes-api.ts`, whose calls the case answers (`gateway-changes-api.test.ts` proves the
// calls).

vi.mock('./gateway-changes-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./gateway-changes-api')>();
  return {
    ...real,
    createInternetGateway: vi.fn(),
    attachInternetGateway: vi.fn(),
    detachInternetGateway: vi.fn(),
    deleteInternetGateway: vi.fn(),
  };
});

const ENDPOINT = 'http://127.0.0.1:9941';
const key = (value: readonly unknown[] | undefined) => JSON.stringify(value ?? []);
const GATEWAY_READS = [VPC_KEYS.gateways(), VPC_KEYS.gateway('igw-1')].map(key).sort();
const AFTER_DETACH = [...GATEWAY_READS, key(VPC_KEYS.routeTables()), key(VPC_KEYS.routeTable())].sort();

let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient();
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const signal = () => new AbortController().signal;
const refusal = new RequestError({ kind: 'other', operation: 'X', code: 'DependencyViolation', message: 'in use' });

function hooks() {
  return renderHook(
    () => ({
      create: useCreateGateway(ENDPOINT),
      attach: useAttachGateway(ENDPOINT),
      detach: useDetachGateway(ENDPOINT),
      remove: useDeleteGateway(ENDPOINT),
    }),
    { wrapper },
  ).result.current;
}

function spyOnReads() {
  return vi.spyOn(client, 'invalidateQueries');
}

function asked(spy: ReturnType<typeof spyOnReads>) {
  return spy.mock.calls.map(([filters]) => key(filters?.queryKey)).sort();
}

describe("an internet gateway's changes", () => {
  it('after a create succeeds → the gateway lists (every filter) and that gateway are asked again', async () => {
    vi.mocked(api.createInternetGateway).mockResolvedValue('igw-1');
    const spy = spyOnReads();
    expect(await hooks().create({ name: 'edge' }, signal())).toBe('igw-1');
    expect(asked(spy)).toEqual(GATEWAY_READS);
  });

  it('after an attach succeeds → the same reads are asked again', async () => {
    vi.mocked(api.attachInternetGateway).mockResolvedValue(undefined);
    const spy = spyOnReads();
    await hooks().attach('igw-1', 'vpc-1', signal());
    expect(vi.mocked(api.attachInternetGateway).mock.calls[0]?.slice(0, 3)).toEqual([ENDPOINT, 'igw-1', 'vpc-1']);
    expect(asked(spy)).toEqual(GATEWAY_READS);
  });

  it('after a detach succeeds → the same reads and the route tables too', async () => {
    vi.mocked(api.detachInternetGateway).mockResolvedValue(undefined);
    const spy = spyOnReads();
    await hooks().detach('igw-1', 'vpc-1', signal());
    expect(vi.mocked(api.detachInternetGateway).mock.calls[0]?.slice(0, 3)).toEqual([ENDPOINT, 'igw-1', 'vpc-1']);
    expect(asked(spy)).toEqual(AFTER_DETACH);
  });

  it('after a delete succeeds → the gateway reads are asked again', async () => {
    vi.mocked(api.deleteInternetGateway).mockResolvedValue(undefined);
    const spy = spyOnReads();
    await hooks().remove('igw-1', signal());
    expect(vi.mocked(api.deleteInternetGateway).mock.calls[0]?.slice(0, 2)).toEqual([ENDPOINT, 'igw-1']);
    expect(asked(spy)).toEqual(GATEWAY_READS);
  });

  it('after one fails → none is', async () => {
    vi.mocked(api.createInternetGateway).mockRejectedValue(refusal);
    vi.mocked(api.attachInternetGateway).mockRejectedValue(refusal);
    vi.mocked(api.detachInternetGateway).mockRejectedValue(refusal);
    vi.mocked(api.deleteInternetGateway).mockRejectedValue(refusal);
    const spy = spyOnReads();
    const current = hooks();
    await expect(current.create({}, signal())).rejects.toBe(refusal);
    await expect(current.attach('igw-1', 'vpc-1', signal())).rejects.toBe(refusal);
    await expect(current.detach('igw-1', 'vpc-1', signal())).rejects.toBe(refusal);
    await expect(current.remove('igw-1', signal())).rejects.toBe(refusal);
    expect(spy).not.toHaveBeenCalled();
  });
});
