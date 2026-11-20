import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import { usePagedChoices, type ChoiceSource } from '../../components/use-paged-choices';
import * as network from '../../lib/ec2-network-choices';
import * as api from './choices-api';
import {
  groupChoices,
  imageChoices,
  instanceTypeChoices,
  keyPairChoices,
  subnetChoices,
  useLaunchGroups,
  vpcChoices,
} from './choices-queries';

// The sources over `choices-api.ts`, whose calls the case answers (`choices-api.test.ts` proves the calls), read
// through the area's paged choices as a field reads them.

vi.mock('./choices-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./choices-api')>();
  return {
    ...real,
    listImageChoices: vi.fn(),
    listInstanceTypeChoices: vi.fn(),
    listGroupChoices: vi.fn(),
    listKeyPairChoices: vi.fn(),
    getDefaultVpc: vi.fn(),
  };
});

vi.mock('../../lib/ec2-network-choices', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/ec2-network-choices')>();
  return { ...real, listSubnetChoices: vi.fn(), listVpcChoices: vi.fn() };
});

const ENDPOINT = 'http://127.0.0.1:9997';

let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  client.clear();
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** The choices of `source` as an opened field with `text` typed reads them; `text` settles before the read. */
function read<T>(source: ChoiceSource<T>, text = '') {
  return renderHook(({ typed }) => usePagedChoices(source, true, typed), {
    wrapper,
    initialProps: { typed: text },
  });
}

describe("EC2's choices", () => {
  it("each list is read by its own reader, 50 a page; the images', the types' and the groups' text is sent, the subnets' and the VPCs' is not", async () => {
    expect(network.CHOICES_PAGE_SIZE).toBe(50);
    vi.mocked(api.listImageChoices).mockResolvedValue({ choices: [{ id: 'ami-1', name: 'al2023' }], nextToken: 'i-t' });
    vi.mocked(api.listInstanceTypeChoices).mockResolvedValue({ choices: [{ type: 't3.micro', architectures: [] }] });
    vi.mocked(network.listSubnetChoices).mockResolvedValue({ choices: [{ id: 'subnet-1' }], nextToken: 's-t' });
    vi.mocked(network.listVpcChoices).mockResolvedValue({ choices: [{ id: 'vpc-1', isDefault: true }] });
    vi.mocked(api.listGroupChoices).mockResolvedValue({ choices: [{ id: 'sg-1', name: 'web' }] });

    const images = read(imageChoices(ENDPOINT));
    await waitFor(() => {
      expect(images.result.current.choices).toEqual([{ id: 'ami-1', name: 'al2023' }]);
    });
    expect(images.result.current.more).toBe(true);
    expect(vi.mocked(api.listImageChoices).mock.calls[0]?.slice(0, 3)).toEqual([ENDPOINT, '', undefined]);
    images.rerender({ typed: 'al' });
    await waitFor(() => {
      expect(vi.mocked(api.listImageChoices).mock.calls[1]?.slice(0, 3)).toEqual([ENDPOINT, 'al', undefined]);
    });
    act(() => {
      images.result.current.loadMore();
    });

    const types = read(instanceTypeChoices(ENDPOINT));
    await waitFor(() => {
      expect(types.result.current.choices).toEqual([{ type: 't3.micro', architectures: [] }]);
    });
    types.rerender({ typed: 't3' });
    await waitFor(() => {
      expect(vi.mocked(api.listInstanceTypeChoices).mock.calls[1]?.slice(0, 3)).toEqual([ENDPOINT, 't3', undefined]);
    });

    const groups = read(groupChoices(ENDPOINT, 'vpc-1'));
    await waitFor(() => {
      expect(groups.result.current.choices).toEqual([{ id: 'sg-1', name: 'web' }]);
    });
    expect(vi.mocked(api.listGroupChoices).mock.calls[0]?.slice(0, 3)).toEqual([
      ENDPOINT,
      { vpcId: 'vpc-1' },
      undefined,
    ]);
    groups.rerender({ typed: 'we' });
    await waitFor(() => {
      expect(vi.mocked(api.listGroupChoices).mock.calls[1]?.slice(0, 3)).toEqual([
        ENDPOINT,
        { vpcId: 'vpc-1', name: 'we' },
        undefined,
      ]);
    });

    const subnets = read(subnetChoices(ENDPOINT), 'zz');
    await waitFor(() => {
      expect(subnets.result.current.choices).toEqual([{ id: 'subnet-1' }]);
    });
    expect(vi.mocked(network.listSubnetChoices).mock.calls[0]?.slice(0, 2)).toEqual([ENDPOINT, undefined]);
    act(() => {
      subnets.result.current.loadMore();
    });
    await waitFor(() => {
      expect(vi.mocked(network.listSubnetChoices).mock.calls[1]?.slice(0, 2)).toEqual([ENDPOINT, 's-t']);
    });

    const vpcs = read(vpcChoices(ENDPOINT), 'zz');
    await waitFor(() => {
      expect(vpcs.result.current.choices).toEqual([{ id: 'vpc-1', isDefault: true }]);
    });
    expect(vi.mocked(network.listVpcChoices).mock.calls[0]?.slice(0, 2)).toEqual([ENDPOINT, undefined]);
    expect(subnetChoices(ENDPOINT).filtering).toBe('none');
    expect(vpcChoices(ENDPOINT).filtering).toBe('none');
  });

  it('the key pairs\' choices are one answer, with no "more"', async () => {
    vi.mocked(api.listKeyPairChoices).mockResolvedValue([{ name: 'dev' }, { name: 'ci' }]);
    const source = keyPairChoices(ENDPOINT);
    expect(source.filtering).toBe('local');
    const pairs = read(source);
    await waitFor(() => {
      expect(pairs.result.current.choices).toEqual([{ name: 'dev' }, { name: 'ci' }]);
    });
    expect(pairs.result.current.more).toBe(false);
    expect(api.listKeyPairChoices).toHaveBeenCalledTimes(1);
  });

  it("the groups' choices for another VPC are another list; with the default VPC's read failed or empty → asked without vpc-id", async () => {
    vi.mocked(api.listGroupChoices).mockImplementation((_at, filters) =>
      Promise.resolve({ choices: [{ id: `sg-of-${filters.vpcId ?? 'any'}` }] }),
    );
    expect(groupChoices(ENDPOINT, 'vpc-1').key).not.toEqual(groupChoices(ENDPOINT, 'vpc-2').key);

    // No subnet: the default VPC's groups.
    vi.mocked(api.getDefaultVpc).mockResolvedValue('vpc-d');
    const launch = renderHook(({ subnetVpc }) => useLaunchGroups(ENDPOINT, subnetVpc), {
      wrapper,
      initialProps: { subnetVpc: undefined as string | undefined },
    });
    expect(launch.result.current.source.ready).toBe(false);
    await waitFor(() => {
      expect(launch.result.current.vpcId).toBe('vpc-d');
    });
    const ofDefault = read(launch.result.current.source);
    await waitFor(() => {
      expect(ofDefault.result.current.choices).toEqual([{ id: 'sg-of-vpc-d' }]);
    });
    // A subnet's VPC: another list.
    launch.rerender({ subnetVpc: 'vpc-2' });
    expect(launch.result.current.vpcId).toBe('vpc-2');
    expect(launch.result.current.vpcFor(undefined)).toBe('vpc-d');
    const ofSubnet = read(launch.result.current.source);
    await waitFor(() => {
      expect(ofSubnet.result.current.choices).toEqual([{ id: 'sg-of-vpc-2' }]);
    });
    launch.unmount();

    // The default VPC's read failed, then answered none: every group's.
    for (const answer of ['failed', 'none'] as const) {
      vi.mocked(api.listGroupChoices).mockClear();
      if (answer === 'failed') {
        vi.mocked(api.getDefaultVpc).mockRejectedValue(
          new RequestError({ kind: 'access-denied', operation: 'DescribeVpcs', message: 'no' }),
        );
      } else {
        vi.mocked(api.getDefaultVpc).mockResolvedValue(undefined);
      }
      const without = renderHook(() => useLaunchGroups(ENDPOINT, undefined), { wrapper });
      await waitFor(() => {
        expect(without.result.current.source.ready).toBe(true);
      });
      expect(without.result.current.vpcId).toBeUndefined();
      const every = read(without.result.current.source);
      await waitFor(() => {
        expect(every.result.current.choices).toEqual([{ id: 'sg-of-any' }]);
      });
      expect(vi.mocked(api.listGroupChoices).mock.calls[0]?.[1]).toEqual({});
      without.unmount();
      every.unmount();
    }
  });
});
