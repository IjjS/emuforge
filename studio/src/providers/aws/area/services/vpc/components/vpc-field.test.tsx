import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import * as network from '../../../lib/ec2-network-choices';
import * as api from '../api';
import { CHOOSE_A_VPC, VpcField } from './vpc-field';

// The field over VPC's source and `useVpc`, whose calls the case answers.

vi.mock('../../../lib/ec2-network-choices', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../lib/ec2-network-choices')>();
  return { ...real, listVpcChoices: vi.fn() };
});

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, getVpc: vi.fn() };
});

const ENGINE = 'http://127.0.0.1:9951';
const CONNECTION: AreaConnection = {
  result: { kind: 'connected', checkedAt: 0, emulator: { port: 9952, endpoint: 'https://127.0.0.1:9952' } },
  engineOrigin: ENGINE,
};

let chosen: (network.VpcChoice | undefined)[];
let settled: (network.VpcChoice | undefined)[];

interface FormProps {
  preset?: string;
  fault?: boolean;
  marks?: ReadonlyMap<string, string>;
}

function Form({ preset, fault, marks }: FormProps) {
  const [value, setValue] = useState<network.VpcChoice>();
  return (
    <VpcField
      connection={CONNECTION}
      value={value}
      onChange={(vpc) => {
        chosen.push(vpc);
        setValue(vpc);
      }}
      preset={preset}
      marks={marks}
      onPresetSettled={(vpc) => {
        settled.push(vpc);
      }}
      errorText={fault === true ? CHOOSE_A_VPC : undefined}
    />
  );
}

function open(props: FormProps = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <Form {...props} />
    </QueryClientProvider>,
  );
  return view;
}

const PAGE = createWrapper(document.body);
const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function select() {
  const found = PAGE.findFormField()?.findControl()?.findSelect();
  if (found === null || found === undefined) {
    throw new Error('no select');
  }
  return found;
}

const dropdownText = () => text(select().findDropdown().getElement());
const shown = () =>
  (select().findDropdown().findOptions() ?? []).map((option) => text(option.findLabel().getElement()));
const isDisabled = () => select().isDisabled();

const VPC_1: network.VpcChoice = { id: 'vpc-1', name: 'app', cidr: '10.0.0.0/16', isDefault: false };
const VPC_D: network.VpcChoice = { id: 'vpc-d', cidr: '172.31.0.0/16', isDefault: true };

beforeEach(() => {
  vi.clearAllMocks();
  chosen = [];
  settled = [];
});

describe('the "VPC" field', () => {
  it('"VPC", "Choose a VPC"; opened → "Loading VPCs", then the choices', async () => {
    let answer: (page: network.ChoicePage<network.VpcChoice>) => void = () => undefined;
    vi.mocked(network.listVpcChoices).mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    open();
    expect(text(PAGE.findFormField()?.findLabel()?.getElement())).toBe('VPC');
    expect(text(select().findTrigger().getElement())).toBe('Choose a VPC');
    select().openDropdown();
    await waitFor(() => {
      expect(dropdownText()).toContain('Loading VPCs');
    });
    act(() => {
      answer({ choices: [VPC_1, VPC_D] });
    });
    await waitFor(() => {
      expect(shown()).toEqual(['vpc-1', 'vpc-d']);
    });
  });

  it('none → "No VPCs"; a typed text that matches none → "No VPCs match"', async () => {
    vi.mocked(network.listVpcChoices).mockResolvedValueOnce({ choices: [] });
    const first = open();
    select().openDropdown();
    await waitFor(() => {
      expect(dropdownText()).toContain('No VPCs');
    });
    first.unmount();

    vi.mocked(network.listVpcChoices).mockResolvedValue({ choices: [VPC_1] });
    open();
    select().openDropdown();
    await waitFor(() => {
      expect(shown()).toEqual(['vpc-1']);
    });
    select().findFilteringInput()?.setInputValue('zzz');
    await waitFor(() => {
      expect(dropdownText()).toContain('No VPCs match');
    });
  });

  it('"Load more" while a token remains', async () => {
    vi.mocked(network.listVpcChoices).mockImplementation((_at, token) =>
      Promise.resolve(token === undefined ? { choices: [VPC_1], nextToken: 't-2' } : { choices: [VPC_D] }),
    );
    open();
    select().openDropdown();
    await waitFor(() => {
      expect(shown()).toEqual(['vpc-1']);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => {
      expect(shown()).toEqual(['vpc-1', 'vpc-d']);
    });
    expect(vi.mocked(network.listVpcChoices).mock.lastCall?.[1]).toBe('t-2');
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('a failed page → "The VPCs could not be loaded" with "Retry", the choices shown kept', async () => {
    vi.mocked(network.listVpcChoices)
      .mockResolvedValueOnce({ choices: [VPC_1], nextToken: 't-2' })
      .mockRejectedValueOnce(
        new RequestError({ kind: 'other', operation: 'DescribeVpcs', code: 'Throttling', message: 'slow' }),
      )
      .mockResolvedValueOnce({ choices: [VPC_D] });
    open();
    select().openDropdown();
    await waitFor(() => {
      expect(shown()).toEqual(['vpc-1']);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => {
      expect(dropdownText()).toContain('The VPCs could not be loaded');
    });
    expect(shown()).toEqual(['vpc-1']);
    const retry = select().findErrorRecoveryButton();
    expect(text(retry?.getElement())).toBe('Retry');
    retry?.click();
    await waitFor(() => {
      expect(shown()).toEqual(['vpc-1', 'vpc-d']);
    });
  });

  it('given no id → nothing is read before the field is opened and nothing is chosen', async () => {
    vi.mocked(network.listVpcChoices).mockResolvedValue({ choices: [VPC_1] });
    open();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(network.listVpcChoices).not.toHaveBeenCalled();
    expect(api.getVpc).not.toHaveBeenCalled();
    expect(chosen).toEqual([]);
    expect(isDisabled()).toBe(false);
  });

  it('given an id → asked by vpc-id at once, the field unchangeable until it answers; with the VPC → chosen, also when the first page does not hold it', async () => {
    let answer: (read: api.Read<api.Vpc>) => void = () => undefined;
    vi.mocked(api.getVpc).mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    vi.mocked(network.listVpcChoices).mockResolvedValue({ choices: [VPC_D] });
    open({ preset: 'vpc-1' });
    await waitFor(() => {
      expect(api.getVpc).toHaveBeenCalled();
    });
    expect(vi.mocked(api.getVpc).mock.calls[0]?.slice(0, 2)).toEqual([ENGINE, 'vpc-1']);
    expect(isDisabled()).toBe(true);
    act(() => {
      answer({
        found: true,
        value: {
          id: 'vpc-1',
          state: 'available',
          cidr: '10.0.0.0/16',
          cidrs: ['10.0.0.0/16'],
          isDefault: false,
          tags: [{ key: 'Name', value: 'app' }],
        },
      });
    });
    await waitFor(() => {
      expect(isDisabled()).toBe(false);
    });
    expect(chosen).toEqual([VPC_1]);
    expect(settled).toEqual([VPC_1]);
    expect(text(select().findTrigger().getElement())).toContain('vpc-1');
    select().openDropdown();
    await waitFor(() => {
      expect(shown()).toEqual(['vpc-d']);
    });
    expect(text(select().findTrigger().getElement())).toContain('vpc-1');
  });

  it('answered empty → unchosen and "The emulator holds no VPC {id}. Choose another."', async () => {
    vi.mocked(api.getVpc).mockResolvedValue({ found: false });
    open({ preset: 'vpc-gone' });
    expect(await screen.findByText('The emulator holds no VPC vpc-gone. Choose another.')).toBeInTheDocument();
    expect(isDisabled()).toBe(false);
    expect(chosen).toEqual([]);
    expect(settled).toEqual([undefined]);
    expect(text(select().findTrigger().getElement())).toBe('Choose a VPC');
  });

  it('the read failed → unchosen without that sentence, and the field can be used', async () => {
    vi.mocked(api.getVpc).mockRejectedValue(
      new RequestError({ kind: 'other', operation: 'DescribeVpcs', code: 'InternalError', message: 'broke' }),
    );
    vi.mocked(network.listVpcChoices).mockResolvedValue({ choices: [VPC_1] });
    open({ preset: 'vpc-1' });
    await waitFor(() => {
      expect(settled).toEqual([undefined]);
    });
    expect(isDisabled()).toBe(false);
    expect(screen.queryByText(/The emulator holds no VPC/)).toBeNull();
    expect(chosen).toEqual([]);
    select().openDropdown();
    await waitFor(() => {
      expect(shown()).toEqual(['vpc-1']);
    });
    select().selectOptionByValue('vpc-1');
    expect(chosen).toEqual([VPC_1]);
  });

  it('a fault given by the form → "Choose a VPC." at the field', () => {
    open({ fault: true });
    expect(text(PAGE.findFormField()?.findError()?.getElement())).toBe('Choose a VPC.');
  });

  it('a VPC chosen → the closed field shows its ID, its name and its block; one without a name → its ID and its block', async () => {
    vi.mocked(network.listVpcChoices).mockResolvedValue({ choices: [VPC_1, VPC_D] });
    open();
    select().openDropdown();
    await waitFor(() => {
      expect(shown()).toEqual(['vpc-1', 'vpc-d']);
    });
    select().selectOptionByValue('vpc-1');
    const named = text(select().findTrigger().getElement());
    expect(named).toContain('vpc-1');
    expect(named).toContain('app');
    expect(named).toContain('10.0.0.0/16');
    select().openDropdown();
    await waitFor(() => {
      expect(network.listVpcChoices).toHaveBeenCalledTimes(2);
      expect(shown()).toEqual(['vpc-1', 'vpc-d']);
    });
    select().selectOptionByValue('vpc-d');
    const unnamed = text(select().findTrigger().getElement());
    expect(unnamed).toContain('vpc-d');
    expect(unnamed).toContain('172.31.0.0/16');
  });

  it('without the marks passed → the options are as before (S5, S8): ID, name, block, "Default VPC"', async () => {
    vi.mocked(network.listVpcChoices).mockResolvedValue({ choices: [VPC_1, VPC_D] });
    open();
    select().openDropdown();
    await waitFor(() => {
      expect(shown()).toEqual(['vpc-1', 'vpc-d']);
    });
    const option = (id: string) => text(select().findDropdown().findOptionByValue(id)?.getElement());
    for (const part of ['vpc-1', 'app', '10.0.0.0/16']) {
      expect(option('vpc-1')).toContain(part);
    }
    for (const part of ['vpc-d', '172.31.0.0/16', 'Default VPC']) {
      expect(option('vpc-d')).toContain(part);
    }
    expect(option('vpc-1')).not.toContain('Has ');
    expect(option('vpc-d')).not.toContain('Has ');
  });

  it('adds a mark to the VPC option and keeps that option choosable', async () => {
    vi.mocked(network.listVpcChoices).mockResolvedValue({ choices: [VPC_1, VPC_D] });
    open({ marks: new Map([['vpc-1', 'Has igw-1']]) });
    select().openDropdown();
    await waitFor(() => {
      expect(shown()).toEqual(['vpc-1', 'vpc-d']);
    });
    const option = select().findDropdown().findOptionByValue('vpc-1');
    expect(text(option?.getElement())).toContain('10.0.0.0/16');
    expect(text(option?.getElement())).toContain('Has igw-1');
    select().selectOptionByValue('vpc-1');
    expect(chosen).toEqual([VPC_1]);
  });
});
