import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import * as api from './api';
import {
  EC2_KEYS,
  useInstance,
  useInstanceAction,
  useInstanceListing,
  useTerminationProtection,
  type ListingFilters,
} from './queries';

// The hooks over `api.ts`, whose calls the case answers: each call waits until the case settles it, so the case
// decides the order in which answers arrive. `api.test.ts` proves the calls themselves against a fake engine.

vi.mock('./api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./api')>();
  return {
    ...real,
    listInstances: vi.fn(),
    getInstance: vi.fn(),
    getTerminationProtection: vi.fn(),
    actOnInstance: vi.fn(),
  };
});

const ENDPOINT = 'http://127.0.0.1:9999';

interface Call {
  args: unknown[];
  signal: AbortSignal;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

/** Each call of a mocked function, held until the case settles it. */
function held(fn: unknown): Call[] {
  const calls: Call[] = [];
  vi.mocked(fn as (...args: unknown[]) => Promise<unknown>).mockImplementation(
    (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        calls.push({ args, signal: args[args.length - 1] as AbortSignal, resolve, reject });
      }),
  );
  return calls;
}

async function nth(calls: Call[], n: number): Promise<Call> {
  await waitFor(() => {
    expect(calls.length).toBeGreaterThan(n);
  });
  return calls[n] as Call;
}

function instance(id: string, state: string): api.Instance {
  return { id, state, groups: [], volumes: [], tags: [] };
}

let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } },
  });
});

afterEach(() => {
  client.clear();
  vi.useRealTimers();
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const ANY: ListingFilters = { state: '', name: '' };

describe('the instances listing', () => {
  it('a change of the state or of the name asks the first page again with the new filters', async () => {
    const calls = held(api.listInstances);
    const { result, rerender } = renderHook(({ filters }) => useInstanceListing(ENDPOINT, filters), {
      wrapper,
      initialProps: { filters: ANY },
    });
    act(() => {
      calls[0]?.resolve({ instances: [instance('i-1', 'running')], nextToken: 't1' });
    });
    await waitFor(() => {
      expect(result.current.openEnd).toBe(true);
    });
    expect(calls[0]?.args.slice(1, 3)).toEqual([{}, undefined]);
    act(() => {
      result.current.goToPage(2);
    });
    expect((await nth(calls, 1)).args[2]).toBe('t1');

    rerender({ filters: { state: 'stopped', name: '' } });
    const byState = await nth(calls, 2);
    expect(byState.args.slice(1, 3)).toEqual([{ state: 'stopped' }, undefined]);
    expect(result.current.currentPage).toBe(1);

    rerender({ filters: { state: 'stopped', name: 'web' } });
    const byBoth = await nth(calls, 3);
    expect(byBoth.args.slice(1, 3)).toEqual([{ state: 'stopped', name: 'web' }, undefined]);
  });

  it('while a row is pending, stopping or shutting-down → asked again after 3 seconds, same token and filters; no more once none is', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls = held(api.listInstances);
    const filters = { state: '', name: 'web' };
    const { result } = renderHook(() => useInstanceListing(ENDPOINT, filters), { wrapper });
    act(() => {
      calls[0]?.resolve({ instances: [instance('i-1', 'running')], nextToken: 't1' });
    });
    await waitFor(() => {
      expect(result.current.openEnd).toBe(true);
    });
    act(() => {
      result.current.goToPage(2);
    });
    const second = await nth(calls, 1);
    act(() => {
      second.resolve({ instances: [instance('i-2', 'stopping'), instance('i-3', 'running')] });
    });
    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_900);
    });
    expect(calls).toHaveLength(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    const polled = await nth(calls, 2);
    expect(polled.args.slice(1, 3)).toEqual([{ name: 'web' }, 't1']);
    expect(result.current.currentPage).toBe(2);
    act(() => {
      polled.resolve({ instances: [instance('i-2', 'stopped'), instance('i-3', 'running')] });
    });
    await waitFor(() => {
      expect(result.current.items?.[0]?.state).toBe('stopped');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(calls).toHaveLength(3);
  });

  it('with no such row → not asked again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls = held(api.listInstances);
    const { result } = renderHook(() => useInstanceListing(ENDPOINT, ANY), { wrapper });
    act(() => {
      calls[0]?.resolve({ instances: [instance('i-1', 'running'), instance('i-2', 'terminated')] });
    });
    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(calls).toHaveLength(1);
  });
});

describe('an instance', () => {
  it('read again every 3 seconds while its state moves by itself, and no more once it does not', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls = held(api.getInstance);
    const { result } = renderHook(() => useInstance(ENDPOINT, 'i-1'), { wrapper });
    expect(result.current.loading).toBe(true);
    act(() => {
      calls[0]?.resolve({ found: true, instance: instance('i-1', 'pending') });
    });
    await waitFor(() => {
      expect(result.current.value).toBeDefined();
    });
    expect(calls[0]?.args[1]).toBe('i-1');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    const again = await nth(calls, 1);
    expect(again.args[1]).toBe('i-1');
    expect(result.current.loading).toBe(false);
    act(() => {
      again.resolve({ found: true, instance: instance('i-1', 'running') });
    });
    await waitFor(() => {
      expect(result.current.value).toEqual({ found: true, instance: instance('i-1', 'running') });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    expect(calls).toHaveLength(2);
  });

  it('a failed read of termination protection leaves the instance read as it is', async () => {
    const reads = held(api.getInstance);
    const protections = held(api.getTerminationProtection);
    const { result } = renderHook(
      () => ({ instance: useInstance(ENDPOINT, 'i-1'), protection: useTerminationProtection(ENDPOINT, 'i-1') }),
      { wrapper },
    );
    act(() => {
      reads[0]?.resolve({ found: true, instance: instance('i-1', 'running') });
    });
    act(() => {
      protections[0]?.reject(new RequestError({ kind: 'other', operation: 'DescribeInstanceAttribute', code: 'Boom' }));
    });
    await waitFor(() => {
      expect(result.current.protection.failure).toEqual({
        kind: 'other',
        operation: 'DescribeInstanceAttribute',
        code: 'Boom',
      });
    });
    expect(result.current.instance.failure).toBeUndefined();
    expect(result.current.instance.value).toEqual({ found: true, instance: instance('i-1', 'running') });
  });
});

describe('the actions', () => {
  for (const outcome of ['200', 'a failure'] as const) {
    it(`after start, stop, reboot or terminate is answered with ${outcome} → the instance lists and that instance are read again`, async () => {
      const lists = held(api.listInstances);
      const reads = held(api.getInstance);
      const protections = held(api.getTerminationProtection);
      const actions = held(api.actOnInstance);
      const { result } = renderHook(
        () => ({
          list: useInstanceListing(ENDPOINT, ANY),
          filtered: useInstanceListing(ENDPOINT, { state: 'running', name: '' }),
          instance: useInstance(ENDPOINT, 'i-1'),
          other: useInstance(ENDPOINT, 'i-2'),
          protection: useTerminationProtection(ENDPOINT, 'i-1'),
          act: useInstanceAction(ENDPOINT),
        }),
        { wrapper },
      );
      await nth(lists, 1);
      await nth(reads, 1);
      act(() => {
        for (const call of lists) call.resolve({ instances: [instance('i-1', 'running')] });
        for (const call of reads) call.resolve({ found: true, instance: instance(String(call.args[1]), 'running') });
        protections[0]?.resolve(false);
      });
      await waitFor(() => {
        expect(result.current.protection.value).toBe(false);
      });
      for (const action of ['start', 'stop', 'reboot', 'terminate'] as const) {
        const [listsBefore, readsBefore, protectionsBefore] = [lists.length, reads.length, protections.length];
        let settled: Promise<void> | undefined;
        act(() => {
          settled = result.current.act(action, 'i-1', new AbortController().signal).catch(() => undefined);
        });
        const sent = await nth(actions, actions.length - 1);
        expect(sent.args.slice(1, 3)).toEqual([action, 'i-1']);
        expect(lists).toHaveLength(listsBefore);
        act(() => {
          if (outcome === '200') {
            sent.resolve(undefined);
          } else {
            sent.reject(new RequestError({ kind: 'other', operation: 'X', code: 'IncorrectInstanceState' }));
          }
        });
        await settled;
        await waitFor(() => {
          expect(lists.length).toBe(listsBefore + 2);
        });
        await waitFor(() => {
          expect(reads.length).toBe(readsBefore + 1);
        });
        expect(reads[reads.length - 1]?.args[1]).toBe('i-1');
        await waitFor(() => {
          expect(protections.length).toBe(protectionsBefore + 1);
        });
        act(() => {
          for (const call of lists.slice(listsBefore)) call.resolve({ instances: [instance('i-1', 'running')] });
          reads[reads.length - 1]?.resolve({ found: true, instance: instance('i-1', 'running') });
          protections[protections.length - 1]?.resolve(false);
        });
      }
    });
  }
});

describe('the keys', () => {
  it('of two lists of different resources, filters or tokens differ', () => {
    const keys = [
      EC2_KEYS.instances('', ''),
      EC2_KEYS.instances('stopped', ''),
      EC2_KEYS.instances('', 'web'),
      EC2_KEYS.instance('i-1'),
      EC2_KEYS.instance('i-2'),
      EC2_KEYS.instance('i-1', 'termination-protection'),
      EC2_KEYS.securityGroups(''),
      EC2_KEYS.securityGroups('web'),
      EC2_KEYS.securityGroup('sg-1'),
      EC2_KEYS.rules('sg-1'),
      EC2_KEYS.rules('sg-2'),
      EC2_KEYS.keyPairs(),
      EC2_KEYS.choices('images', ''),
      EC2_KEYS.choices('images', 'al2023'),
      EC2_KEYS.choices('key-pairs'),
      EC2_KEYS.choices('security-groups', 'vpc-1', ''),
      EC2_KEYS.choices('security-groups', 'vpc-2', ''),
    ].map((key) => JSON.stringify(key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("of two pages' reads differ by their tokens", async () => {
    const calls = held(api.listInstances);
    const { result } = renderHook(() => useInstanceListing(ENDPOINT, ANY), { wrapper });
    act(() => {
      calls[0]?.resolve({ instances: [instance('i-1', 'running')], nextToken: 't1' });
    });
    await waitFor(() => {
      expect(result.current.openEnd).toBe(true);
    });
    act(() => {
      result.current.goToPage(2);
    });
    await nth(calls, 1);
    const keys = client
      .getQueryCache()
      .findAll({ queryKey: EC2_KEYS.instances() })
      .map((query) => JSON.stringify(query.queryKey));
    expect(keys.some((key) => key.includes('"t1"'))).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
