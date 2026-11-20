import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import * as api from './group-api';
import { useDeleteGroup, useDeleteRule, useGroupListing, useRuleListing, useSecurityGroup } from './group-queries';
import { EC2_KEYS } from './queries';

// The hooks over `group-api.ts`, whose calls the case answers: each call waits until the case settles it.
// `group-api.test.ts` proves the calls themselves against a fake engine.

vi.mock('./group-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./group-api')>();
  return {
    ...real,
    listSecurityGroups: vi.fn(),
    getSecurityGroup: vi.fn(),
    listSecurityGroupRules: vi.fn(),
    deleteSecurityGroup: vi.fn(),
    deleteSecurityGroupRule: vi.fn(),
  };
});

const ENDPOINT = 'http://127.0.0.1:9999';

interface Call {
  args: unknown[];
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

function held(fn: unknown): Call[] {
  const calls: Call[] = [];
  vi.mocked(fn as (...args: unknown[]) => Promise<unknown>).mockImplementation(
    (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        calls.push({ args, resolve, reject });
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

const group = (id: string): api.SecurityGroup => ({ id, name: id });
const rule = (id: string): api.SecurityGroupRule => ({ id, egress: false, protocol: 'tcp' });

let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } },
  });
});

afterEach(() => {
  client.clear();
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('the groups listing', () => {
  it('a page at a time by token; a changed name filter asks the first page again', async () => {
    const calls = held(api.listSecurityGroups);
    const { result, rerender } = renderHook(({ name }) => useGroupListing(ENDPOINT, name), {
      wrapper,
      initialProps: { name: '' },
    });
    const first = await nth(calls, 0);
    expect(first.args.slice(1, 3)).toEqual(['', undefined]);
    act(() => {
      first.resolve({ groups: [group('sg-1')], nextToken: 't1' });
    });
    await waitFor(() => {
      expect(result.current.openEnd).toBe(true);
    });
    act(() => {
      result.current.goToPage(2);
    });
    const second = await nth(calls, 1);
    expect(second.args.slice(1, 3)).toEqual(['', 't1']);
    act(() => {
      second.resolve({ groups: [group('sg-2')] });
    });
    await waitFor(() => {
      expect(result.current.items?.map((one) => one.id)).toEqual(['sg-2']);
    });

    rerender({ name: 'web' });
    const third = await nth(calls, 2);
    expect(third.args.slice(1, 3)).toEqual(['web', undefined]);
    expect(result.current.currentPage).toBe(1);
  });
});

describe("a group's rules", () => {
  it('a page at a time by token', async () => {
    const calls = held(api.listSecurityGroupRules);
    const { result } = renderHook(() => useRuleListing(ENDPOINT, 'sg-1'), { wrapper });
    const first = await nth(calls, 0);
    expect(first.args.slice(1, 3)).toEqual(['sg-1', undefined]);
    act(() => {
      first.resolve({ rules: [rule('sgr-1')], nextToken: 'r1' });
    });
    await waitFor(() => {
      expect(result.current.openEnd).toBe(true);
    });
    act(() => {
      result.current.goToPage(2);
    });
    const second = await nth(calls, 1);
    expect(second.args.slice(1, 3)).toEqual(['sg-1', 'r1']);
  });
});

/** Every read a delete could read again, with a stand-in for the group choices of the launch and rule forms. */
function useEverything() {
  const choices = useQuery({
    queryKey: [...EC2_KEYS.choices('security-groups', 'vpc-1', ''), 'case'],
    queryFn: () => api.listSecurityGroups(ENDPOINT, '', undefined, new AbortController().signal),
    staleTime: 0,
  });
  return {
    list: useGroupListing(ENDPOINT, ''),
    filtered: useGroupListing(ENDPOINT, 'web'),
    group: useSecurityGroup(ENDPOINT, 'sg-1'),
    rules: useRuleListing(ENDPOINT, 'sg-1'),
    otherRules: useRuleListing(ENDPOINT, 'sg-2'),
    choices,
    deleteGroup: useDeleteGroup(ENDPOINT),
    deleteRule: useDeleteRule(ENDPOINT),
  };
}

describe('after a delete', () => {
  for (const outcome of ['200', 'a failure'] as const) {
    it(`a group's delete answered with ${outcome} → ${outcome === '200' ? 'the group lists and the group choices are' : 'nothing is'} read again`, async () => {
      const lists = held(api.listSecurityGroups);
      const reads = held(api.getSecurityGroup);
      const rules = held(api.listSecurityGroupRules);
      const deletes = held(api.deleteSecurityGroup);
      const { result } = renderHook(useEverything, { wrapper });
      await nth(lists, 2);
      await nth(reads, 0);
      await nth(rules, 1);
      act(() => {
        for (const call of lists) call.resolve({ groups: [group('sg-1')] });
        reads[0]?.resolve({ found: true, group: group('sg-1') });
        for (const call of rules) call.resolve({ rules: [] });
      });
      await waitFor(() => {
        expect(result.current.choices.data).toBeDefined();
      });
      const [listsBefore, readsBefore, rulesBefore] = [lists.length, reads.length, rules.length];
      let settled: Promise<void> | undefined;
      act(() => {
        settled = result.current.deleteGroup('sg-1', new AbortController().signal).catch(() => undefined);
      });
      const sent = await nth(deletes, 0);
      expect(sent.args.slice(1, 2)).toEqual(['sg-1']);
      act(() => {
        if (outcome === '200') sent.resolve(undefined);
        else sent.reject(new RequestError({ kind: 'other', operation: 'DeleteSecurityGroup', code: 'DependencyViolation' }));
      });
      await settled;
      if (outcome === '200') {
        // The two lists and the choices.
        await waitFor(() => {
          expect(lists.length).toBe(listsBefore + 3);
        });
      } else {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
        });
        expect(lists.length).toBe(listsBefore);
      }
      expect(reads.length).toBe(readsBefore);
      expect(rules.length).toBe(rulesBefore);
    });

    it(`a rule's delete answered with ${outcome} → ${outcome === '200' ? "that group's rules are" : 'nothing is'} read again`, async () => {
      const lists = held(api.listSecurityGroups);
      const reads = held(api.getSecurityGroup);
      const rules = held(api.listSecurityGroupRules);
      const deletes = held(api.deleteSecurityGroupRule);
      const { result } = renderHook(useEverything, { wrapper });
      await nth(lists, 2);
      await nth(reads, 0);
      await nth(rules, 1);
      act(() => {
        for (const call of lists) call.resolve({ groups: [group('sg-1')] });
        reads[0]?.resolve({ found: true, group: group('sg-1') });
        for (const call of rules) call.resolve({ rules: [rule('sgr-1')] });
      });
      await waitFor(() => {
        expect(result.current.rules.items).toBeDefined();
      });
      const [listsBefore, readsBefore, rulesBefore] = [lists.length, reads.length, rules.length];
      let settled: Promise<void> | undefined;
      act(() => {
        settled = result.current
          .deleteRule('sg-1', { id: 'sgr-1', egress: true }, new AbortController().signal)
          .catch(() => undefined);
      });
      const sent = await nth(deletes, 0);
      expect(sent.args.slice(1, 3)).toEqual(['sg-1', { id: 'sgr-1', egress: true }]);
      act(() => {
        if (outcome === '200') sent.resolve(undefined);
        else sent.reject(new RequestError({ kind: 'other', operation: 'RevokeSecurityGroupEgress', code: 'X' }));
      });
      await settled;
      if (outcome === '200') {
        await waitFor(() => {
          expect(rules.length).toBe(rulesBefore + 1);
        });
        expect(rules.at(-1)?.args[1]).toBe('sg-1');
      } else {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
        });
        expect(rules.length).toBe(rulesBefore);
      }
      expect(lists.length).toBe(listsBefore);
      expect(reads.length).toBe(readsBefore);
    });
  }
});
