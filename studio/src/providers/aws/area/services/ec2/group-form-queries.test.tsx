import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import * as api from './group-form-api';
import { useAddRule, useCreateSecurityGroup } from './group-form-queries';
import { EC2_KEYS } from './queries';

// The create and add hooks over `group-form-api.ts`, whose calls the case answers (`group-form-api.test.ts` proves
// the calls).

vi.mock('./group-form-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./group-form-api')>();
  return { ...real, createSecurityGroup: vi.fn(), addSecurityGroupRule: vi.fn() };
});

const ENDPOINT = 'http://127.0.0.1:9995';
const GROUP: api.NewSecurityGroup = { name: 'web', description: 'Web servers' };
const RULE: api.NewRule = { egress: false, protocol: 'tcp', fromPort: 22, peer: { kind: 'ipv4', value: '10.0.0.0/16' } };

let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const refusal = (operation: string) =>
  new RequestError({ kind: 'other', operation, code: 'InvalidGroup.Duplicate', message: 'no' });

describe('the create and add hooks', () => {
  it('after a group is created → the group lists and the group choices are read again; after it fails → none is', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreateSecurityGroup(ENDPOINT), { wrapper });
    const signal = new AbortController().signal;

    vi.mocked(api.createSecurityGroup).mockResolvedValueOnce('sg-0new');
    await expect(result.current(GROUP, signal)).resolves.toBe('sg-0new');
    expect(api.createSecurityGroup).toHaveBeenCalledWith(ENDPOINT, GROUP, signal);
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: EC2_KEYS.securityGroups() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: EC2_KEYS.choices('security-groups') });

    invalidate.mockClear();
    const failed = refusal('CreateSecurityGroup');
    vi.mocked(api.createSecurityGroup).mockRejectedValueOnce(failed);
    await expect(result.current(GROUP, signal)).rejects.toBe(failed);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("after a rule is added → that group's rules are read again; after it fails → none is", async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useAddRule(ENDPOINT), { wrapper });
    const signal = new AbortController().signal;

    vi.mocked(api.addSecurityGroupRule).mockResolvedValueOnce(undefined);
    await result.current('sg-1', RULE, signal);
    expect(api.addSecurityGroupRule).toHaveBeenCalledWith(ENDPOINT, 'sg-1', RULE, signal);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: EC2_KEYS.rules('sg-1') });

    invalidate.mockClear();
    const failed = refusal('AuthorizeSecurityGroupIngress');
    vi.mocked(api.addSecurityGroupRule).mockRejectedValueOnce(failed);
    await expect(result.current('sg-1', RULE, signal)).rejects.toBe(failed);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
