import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { createElement, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChoiceSelect } from '../../components/choice-select';
import type { AreaConnection } from '../../components/emulator-line';
import type { ChoiceSource } from '../../components/use-paged-choices';
import * as network from '../../lib/ec2-network-choices';
import { subnetChoices, vpcChoices } from './choices';

// VPC's sources over the area's lifted reads, whose calls the case answers (`ec2-network-choices.test.ts` proves the
// calls), read through the area's choice field as a form reads them.

vi.mock('../../lib/ec2-network-choices', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/ec2-network-choices')>();
  return { ...real, listVpcChoices: vi.fn(), listSubnetChoices: vi.fn() };
});

const ENGINE = 'http://127.0.0.1:9932';
const CONNECTION: AreaConnection = {
  result: { kind: 'connected', checkedAt: 0, emulator: { port: 9933, endpoint: 'https://127.0.0.1:9933' } },
  engineOrigin: ENGINE,
};

function Field<T>({ source }: { source: ChoiceSource<T> }) {
  const [value, setValue] = useState<T>();
  return createElement(ChoiceSelect<T>, {
    source,
    connection: CONNECTION,
    things: 'things',
    value,
    onChange: setValue,
  });
}

function open<T>(source: ChoiceSource<T>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(createElement(QueryClientProvider, { client }, createElement(Field<T>, { source })));
  const select = createWrapper(view.container).findSelect();
  if (select === null) {
    throw new Error('no select');
  }
  select.openDropdown();
  return select;
}

const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the VPC choices', () => {
  it('read by the lifted read, a page at a time; a typed text is not sent and narrows the choices read', async () => {
    expect(network.CHOICES_PAGE_SIZE).toBe(50);
    vi.mocked(network.listVpcChoices).mockResolvedValue({
      choices: [
        { id: 'vpc-1', name: 'app', cidr: '10.0.0.0/16', isDefault: false },
        { id: 'vpc-d', cidr: '172.31.0.0/16', isDefault: true },
      ],
    });
    const select = open(vpcChoices(ENGINE));
    await waitFor(() => {
      expect(select.findDropdown().findOptions()).toHaveLength(2);
    });
    expect(vi.mocked(network.listVpcChoices).mock.calls[0]?.slice(0, 2)).toEqual([ENGINE, undefined]);
    select.findFilteringInput()?.setInputValue('app');
    await waitFor(() => {
      expect(select.findDropdown().findOptions()).toHaveLength(1);
    });
    expect(vi.mocked(network.listVpcChoices)).toHaveBeenCalledTimes(1);
    expect(vpcChoices(ENGINE).filtering).toBe('local');
  });

  it('a choice\'s label is its ID and it shows its name, its block and "Default VPC" for the default one; no name without one', async () => {
    vi.mocked(network.listVpcChoices).mockResolvedValue({
      choices: [
        { id: 'vpc-1', name: 'app', cidr: '10.0.0.0/16', isDefault: false },
        { id: 'vpc-d', cidr: '172.31.0.0/16', isDefault: true },
      ],
    });
    const source = vpcChoices(ENGINE);
    expect(source.optionOf({ id: 'vpc-1', name: 'app', cidr: '10.0.0.0/16', isDefault: false })).toEqual({
      value: 'vpc-1',
      label: 'vpc-1',
      description: 'app',
      tags: ['10.0.0.0/16'],
    });
    expect(source.optionOf({ id: 'vpc-d', cidr: '172.31.0.0/16', isDefault: true })).toEqual({
      value: 'vpc-d',
      label: 'vpc-d',
      tags: ['172.31.0.0/16', 'Default VPC'],
    });
    expect(source.readAgainOnOpen).toBe(true);
    const select = open(source);
    await waitFor(() => {
      expect(select.findDropdown().findOptions()).toHaveLength(2);
    });
    const options = (select.findDropdown().findOptions() ?? []).map((option) => text(option.getElement()));
    expect(options[0]).toContain('vpc-1');
    expect(options[0]).toContain('app');
    expect(options[0]).toContain('10.0.0.0/16');
    expect(options[1]).toContain('Default VPC');
  });
});

describe('the subnet choices of a VPC', () => {
  it("read with that VPC's id; a choice's label is its ID with its name, block and Availability Zone", async () => {
    vi.mocked(network.listSubnetChoices).mockResolvedValue({
      choices: [{ id: 'subnet-1', name: 'app-a', cidr: '10.0.1.0/24', zone: 'us-east-1a', vpcId: 'vpc-1' }],
    });
    const source = subnetChoices(ENGINE, 'vpc-1');
    expect(source.readAgainOnOpen).toBe(true);
    const select = open(source);
    await waitFor(() => {
      expect(select.findDropdown().findOptions()).toHaveLength(1);
    });
    const call = vi.mocked(network.listSubnetChoices).mock.calls[0];
    expect(call?.[0]).toBe(ENGINE);
    expect(call?.[1]).toBeUndefined();
    expect(call?.[3]).toBe('vpc-1');
    expect(source.optionOf({ id: 'subnet-1', name: 'app-a', cidr: '10.0.1.0/24', zone: 'us-east-1a' })).toEqual({
      value: 'subnet-1',
      label: 'subnet-1',
      description: 'app-a',
      tags: ['us-east-1a · 10.0.1.0/24'],
    });
    expect(source.optionOf({ id: 'subnet-2' })).toEqual({ value: 'subnet-2', label: 'subnet-2', tags: [] });
    expect(source.filtering).toBe('local');
  });

  it('the choices of another VPC are another list', () => {
    expect(JSON.stringify(subnetChoices(ENGINE, 'vpc-1').key)).not.toBe(
      JSON.stringify(subnetChoices(ENGINE, 'vpc-2').key),
    );
    expect(JSON.stringify(subnetChoices(ENGINE, 'vpc-1').key)).toBe(JSON.stringify(subnetChoices(ENGINE, 'vpc-1').key));
  });
});
