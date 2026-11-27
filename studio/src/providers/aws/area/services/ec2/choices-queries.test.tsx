import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePagedChoices, type ChoiceSource } from '../../components/use-paged-choices';
import * as network from '../../lib/ec2-network-choices';
import * as api from './choices-api';
import {
  groupChoices,
  imageChoices,
  instanceTypeChoices,
  keyPairChoices,
  subnetChoices,
  useInstanceTypeOfferings,
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
    listInstanceTypeOfferings: vi.fn(),
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

    const subnets = read(subnetChoices(ENDPOINT, 'vpc-1'), 'zz');
    await waitFor(() => {
      expect(subnets.result.current.choices).toEqual([{ id: 'subnet-1' }]);
    });
    expect(network.listSubnetChoices).toHaveBeenCalledWith(ENDPOINT, undefined, expect.any(AbortSignal), 'vpc-1');
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
    expect(subnetChoices(ENDPOINT, 'vpc-1').filtering).toBe('none');
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

  it('describes VPCs, subnets, types, images and key pairs using the values supplied', () => {
    const vpcs = vpcChoices(ENDPOINT);
    const subnets = subnetChoices(ENDPOINT, 'vpc-1');
    const images = imageChoices(ENDPOINT);
    const groups = groupChoices(ENDPOINT, 'vpc-1');
    const keys = keyPairChoices(ENDPOINT);
    expect(vpcs.optionOf({ id: 'vpc-1', isDefault: true, cidr: '10.0.0.0/16' })).toEqual({
      value: 'vpc-1',
      label: 'vpc-1',
      description: '10.0.0.0/16',
      tags: ['Default VPC'],
    });
    expect(vpcs.optionOf({ id: 'vpc-2', isDefault: false })).toEqual({ value: 'vpc-2', label: 'vpc-2' });
    expect(
      subnets.optionOf({ id: 'subnet-1', zone: 'zone-a', cidr: '10.0.0.0/24', availableIpAddressCount: 0 }).description,
    ).toBe('zone-a · 10.0.0.0/24 · 0 free addresses');
    expect(subnets.optionOf({ id: 'subnet-1', cidr: '10.0.0.0/24' }).description).toBe('10.0.0.0/24');
    expect(images.optionOf({ id: 'ami-1', architecture: 'arm64', description: 'Amazon Linux' }).description).toBe(
      'arm64 · Amazon Linux',
    );
    expect(keys.optionOf({ name: 'dev', type: 'ed25519' }).description).toBe('ed25519');
    expect(
      instanceTypeChoices(ENDPOINT).optionOf({
        type: 't3.micro',
        vcpus: 2,
        memoryMiB: 512,
        architectures: ['x86_64', 'i386'],
      }).description,
    ).toBe('2 vCPU · 0.5 GiB · x86_64, i386');
    for (const source of [vpcs, subnets, images, groups, keys]) expect(source.readAgainOnOpen).toBe(true);
    expect(groups.key).not.toEqual(groupChoices(ENDPOINT, 'vpc-2').key);
  });

  it('filters each instance type page and advances past a page with no offered types', async () => {
    const excluded = { type: 't3.micro', architectures: [] };
    const included = { type: 'c7g.large', architectures: ['arm64'] };
    vi.mocked(api.listInstanceTypeChoices)
      .mockResolvedValueOnce({ choices: [excluded], nextToken: 'next' })
      .mockResolvedValueOnce({ choices: [included, excluded], nextToken: 'later' });
    const source = instanceTypeChoices(ENDPOINT, 'zone-a', new Set([included.type]));
    const signal = new AbortController().signal;
    expect(await source.read(ENDPOINT, 'text', undefined, signal)).toEqual({ items: [included], next: 'later' });
    expect(api.listInstanceTypeChoices).toHaveBeenNthCalledWith(1, ENDPOINT, 'text', undefined, signal);
    expect(api.listInstanceTypeChoices).toHaveBeenNthCalledWith(2, ENDPOINT, 'text', 'next', signal);
  });

  it('keeps the current zone’s offerings when an earlier zone answers last', async () => {
    let answerFirst: (types: ReadonlySet<string>) => void = () => undefined;
    const first = new Promise<ReadonlySet<string>>((resolve) => {
      answerFirst = resolve;
    });
    vi.mocked(api.listInstanceTypeOfferings)
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(new Set(['c7g.large']));
    const { result, rerender } = renderHook(({ zone }) => useInstanceTypeOfferings(ENDPOINT, zone), {
      wrapper,
      initialProps: { zone: 'zone-a' },
    });
    await waitFor(() =>
      expect(api.listInstanceTypeOfferings).toHaveBeenCalledWith(ENDPOINT, 'zone-a', expect.any(AbortSignal)),
    );
    rerender({ zone: 'zone-b' });
    await waitFor(() => expect(result.current.types).toEqual(new Set(['c7g.large'])));
    await act(async () => {
      answerFirst(new Set(['t3.micro']));
      await first;
    });
    expect(result.current.types).toEqual(new Set(['c7g.large']));
    expect(vi.mocked(api.listInstanceTypeOfferings).mock.calls[0]?.[2].aborted).toBe(true);
  });
});
