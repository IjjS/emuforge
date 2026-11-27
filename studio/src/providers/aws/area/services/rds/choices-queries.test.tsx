import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as area from '../../components/security-group-choices';
import { usePagedChoices, type ChoiceSource } from '../../components/use-paged-choices';
import * as api from './choices-api';
import { engineVersionChoices, groupChoices, subnetGroupChoices, useOrderableRows } from './choices-queries';

// The sources over `choices-api.ts`, whose calls the case answers (`choices-api.test.ts` proves the calls), read
// through the area's paged choices as a field reads them.

vi.mock('./choices-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./choices-api')>();
  return { ...real, listEngineVersionChoices: vi.fn(), listSubnetGroupChoices: vi.fn(), readOrderableRows: vi.fn() };
});

vi.mock('../../components/security-group-choices', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../components/security-group-choices')>();
  return { ...real, securityGroupChoices: vi.fn(real.securityGroupChoices) };
});

const ENDPOINT = 'http://127.0.0.1:9897';

let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(api.listEngineVersionChoices).mockImplementation((_at, engine) =>
    Promise.resolve({ choices: [{ version: engine === 'mysql' ? '8.4.7' : '18.3' }] }),
  );
  vi.mocked(api.listSubnetGroupChoices).mockResolvedValue({
    choices: [{ name: 'default', description: 'default', vpcId: 'vpc-d' }],
  });
});

afterEach(() => {
  client.clear();
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function read<T>(source: ChoiceSource<T>, text = '') {
  return renderHook(() => usePagedChoices(source, true, text), { wrapper });
}

describe("RDS's choice sources", () => {
  it("another engine's versions are another list; neither the versions nor the subnet groups send a typed text", async () => {
    const postgres = engineVersionChoices(ENDPOINT, 'postgres');
    const mysql = engineVersionChoices(ENDPOINT, 'mysql');
    expect(postgres.key).not.toEqual(mysql.key);
    expect(postgres.filtering).toBe('none');
    expect(subnetGroupChoices(ENDPOINT).filtering).toBe('none');

    const first = read(postgres, 'typed');
    await waitFor(() => {
      expect(first.result.current.choices).toEqual([{ version: '18.3' }]);
    });
    const second = read(mysql, 'typed');
    await waitFor(() => {
      expect(second.result.current.choices).toEqual([{ version: '8.4.7' }]);
    });
    expect(vi.mocked(api.listEngineVersionChoices).mock.calls.map((call) => call.slice(0, 3))).toEqual([
      [ENDPOINT, 'postgres', undefined],
      [ENDPOINT, 'mysql', undefined],
    ]);

    const groups = read(subnetGroupChoices(ENDPOINT), 'typed');
    await waitFor(() => {
      expect(groups.result.current.choices).toHaveLength(1);
    });
    expect(vi.mocked(api.listSubnetGroupChoices).mock.calls[0]?.slice(0, 2)).toEqual([ENDPOINT, undefined]);
  });

  it("a version's option is the version with its description; a subnet group's its name with its VPC ID and description", () => {
    expect(
      engineVersionChoices(ENDPOINT, 'postgres').optionOf({ version: '18.3', description: 'PostgreSQL 18.3-R1' }),
    ).toEqual({
      value: '18.3',
      label: '18.3',
      description: 'PostgreSQL 18.3-R1',
    });
    expect(engineVersionChoices(ENDPOINT, 'postgres').optionOf({ version: '17.7' })).toEqual({
      value: '17.7',
      label: '17.7',
    });
    expect(
      subnetGroupChoices(ENDPOINT).optionOf({ name: 'default', description: 'the default group', vpcId: 'vpc-d' }),
    ).toEqual({ value: 'default', label: 'default', tags: ['vpc-d'], description: 'the default group' });
  });

  it("the security groups' source is the area's, asked with no VPC", () => {
    const source = groupChoices(ENDPOINT);
    expect(area.securityGroupChoices).toHaveBeenCalledWith(ENDPOINT);
    expect(source.key).toEqual(area.securityGroupChoicesKey(undefined));
    expect(source.operation).toBe('DescribeSecurityGroups');
  });
});

describe('reads of orderable rows', () => {
  const readRows = vi.mocked(api.readOrderableRows);
  const postgres = [{ DBInstanceClass: 'db.postgres' }];
  const mysql = [{ DBInstanceClass: 'db.mysql' }];

  function readPair() {
    return renderHook(({ engine, version }) => useOrderableRows(ENDPOINT, engine, version), {
      wrapper,
      initialProps: { engine: 'postgres', version: '18.3' },
    });
  }

  it('reads each selected engine and version once', async () => {
    readRows.mockResolvedValueOnce(postgres).mockResolvedValueOnce(mysql);
    const hook = readPair();
    await waitFor(() => expect(hook.result.current.data).toEqual(postgres));
    hook.rerender({ engine: 'mysql', version: '8.4.7' });
    await waitFor(() => expect(hook.result.current.data).toEqual(mysql));
    expect(readRows.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      [ENDPOINT, 'postgres', '18.3'],
      [ENDPOINT, 'mysql', '8.4.7'],
    ]);
  });

  it('ignores an answer for a pair that is no longer selected', async () => {
    const first = Promise.withResolvers<typeof postgres>();
    const second = Promise.withResolvers<typeof mysql>();
    readRows.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const hook = readPair();
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(1));
    hook.rerender({ engine: 'mysql', version: '8.4.7' });
    await waitFor(() => expect(readRows).toHaveBeenCalledTimes(2));
    first.resolve(postgres);
    await act(() => first.promise.then(() => undefined));
    expect(hook.result.current.data).toBeUndefined();
    second.resolve(mysql);
    await waitFor(() => expect(hook.result.current.data).toEqual(mysql));
  });

  it('reports a failed read and can retry it', async () => {
    readRows.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce(postgres);
    const hook = readPair();
    await waitFor(() =>
      expect(hook.result.current.failure).toMatchObject({
        operation: 'DescribeOrderableDBInstanceOptions',
        kind: 'other',
      }),
    );
    expect(hook.result.current.data).toBeUndefined();
    act(() => hook.result.current.retry());
    await waitFor(() => expect(hook.result.current.data).toEqual(postgres));
    expect(readRows).toHaveBeenCalledTimes(2);
  });

  it('refreshes held subnet groups and describes their VPC and zones', () => {
    const source = subnetGroupChoices(ENDPOINT);
    expect(source.readAgainOnOpen).toBe(true);
    expect(
      source.optionOf({
        name: 'default',
        vpcId: 'vpc-d',
        zones: ['us-east-1a', 'us-east-1b'],
        description: 'Private subnets',
      }),
    ).toEqual({
      value: 'default',
      label: 'default',
      tags: ['vpc-d · us-east-1a · us-east-1b'],
      description: 'Private subnets',
    });
  });
});
