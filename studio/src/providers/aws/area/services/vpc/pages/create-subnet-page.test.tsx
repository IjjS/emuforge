import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import * as network from '../../../lib/ec2-network-choices';
import * as api from '../api';
import * as availability from '../../../lib/ec2-availability-zones';
import * as changes from '../subnet-changes-api';

// S5 rendered inside the area's layout, with the calls of `lib/ec2-network-choices.ts`, `api.ts` and
// `subnet-changes-api.ts` answered by the case (their own tests prove the calls against a fake engine).

vi.mock('../../../lib/ec2-network-choices', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../lib/ec2-network-choices')>();
  return { ...real, listVpcChoices: vi.fn() };
});

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, getVpc: vi.fn(), getSubnet: vi.fn(), listRouteTables: vi.fn(), listSubnets: vi.fn() };
});

vi.mock('../../../lib/ec2-availability-zones', async (original) => ({
  ...(await original<typeof availability>()),
  listAvailabilityZones: vi.fn(),
}));

vi.mock('../subnet-changes-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../subnet-changes-api')>();
  return { ...real, createSubnet: vi.fn() };
});

// TanStack Query hands its notifications to React on a 0 ms timer; here it notifies in a microtask, as
// `src/test/home-test-kit.tsx` does, so `settled()` below comes after every notification by order alone.
notifyManager.setScheduler((callback) => queueMicrotask(callback));

// ---------------------------------------------------------------------------------------------------------------
// The area as Studio's frame renders it.

class Connection {
  value: AreaConnection = { result: undefined, engineOrigin: undefined };
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly get = () => this.value;
}

const EMULATOR = { port: 9577, endpoint: 'https://127.0.0.1:9577' };
const connectedResult = (): CheckResult => ({ kind: 'connected', checkedAt: Date.now(), emulator: EMULATOR });

let connection: Connection;
const ENGINE = 'http://127.0.0.1:8577';

function AreaWithStudioProps() {
  const { pathname } = useLocation();
  const [seen, setSeen] = useState({ pathname, changes: 0 });
  const current = useSyncExternalStore(connection.subscribe, connection.get);
  let changes = seen.changes;
  if (seen.pathname !== pathname) {
    changes += 1;
    setSeen({ pathname, changes });
  }
  return (
    <AwsArea
      headerSelector="#top-bar"
      onPageTitle={() => undefined}
      onContentTarget={() => undefined}
      routeChanges={changes}
      connection={current}
    />
  );
}

function matchMedia(query: string): MediaQueryList {
  return {
    media: query,
    matches: false,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as MediaQueryList;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('matchMedia', matchMedia);
  connection = new Connection();
  connection.value = { result: connectedResult(), engineOrigin: ENGINE };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function open(path = CREATE_PATH) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Studio&apos;s Home</p> },
      { path: '/aws/*', element: <AreaWithStudioProps /> },
    ],
    { initialEntries: [path] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

// ---------------------------------------------------------------------------------------------------------------
// What the emulator holds, as the readers answer it.

const CREATE_PATH = '/aws/vpc/subnets/create';
const NAME_RULE = 'Up to 256 characters. Stored as the Name tag.';
const BLOCK_DESCRIPTION =
  "The emulator refuses a block outside the VPC's block and one that overlaps another subnet of the VPC.";
const BLOCK_RULE = 'An IPv4 block in CIDR notation, from /16 to /28, such as 10.0.1.0/24.';
const ZONES = ['us-east-1a', 'us-east-1b', 'us-east-1c'];

const VPC_X: network.VpcChoice = { id: 'vpc-x', name: 'app', cidr: '10.0.0.0/16', isDefault: false };
const VPC_D: network.VpcChoice = { id: 'vpc-d', cidr: '172.31.0.0/16', isDefault: true };

function created(id: string): api.Subnet {
  return {
    id,
    state: 'available',
    vpcId: 'vpc-x',
    cidr: '10.0.1.0/24',
    zone: 'us-east-1a',
    isDefault: false,
    publicAddresses: false,
    tags: [],
  };
}

beforeEach(() => {
  vi.mocked(network.listVpcChoices).mockResolvedValue({ choices: [VPC_X, VPC_D] });
  vi.mocked(availability.listAvailabilityZones).mockResolvedValue(ZONES);
  vi.mocked(changes.createSubnet).mockResolvedValue('subnet-0new');
  vi.mocked(api.getVpc).mockResolvedValue({
    found: true,
    value: {
      id: 'vpc-x',
      state: 'available',
      cidr: '10.0.0.0/16',
      cidrs: ['10.0.0.0/16'],
      isDefault: false,
      tags: [{ key: 'Name', value: 'app' }],
    },
  });
  vi.mocked(api.getSubnet).mockImplementation((_at, id) => Promise.resolve({ found: true, value: created(id) }));
  vi.mocked(api.listRouteTables).mockResolvedValue({ items: [] });
  vi.mocked(api.listSubnets).mockResolvedValue({ items: [] });
});

// ---------------------------------------------------------------------------------------------------------------
// The form as a user reads and fills it.

const PAGE = createWrapper(document.body);
const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function field(label: string) {
  const found = PAGE.findAllFormFields().find((each) => text(each.findLabel()?.getElement()) === label);
  if (found === undefined) {
    throw new Error(`no field ${label}`);
  }
  return found;
}

function inputOf(label: string): HTMLInputElement {
  const input = field(label).getElement().querySelector('input');
  if (input === null) {
    throw new Error(`no input in ${label}`);
  }
  return input;
}

function type(label: string, value: string) {
  fireEvent.change(inputOf(label), { target: { value } });
}

function selectOf(label: string) {
  const found = createWrapper(field(label).getElement()).findSelect();
  if (found === null) {
    throw new Error(`no select in ${label}`);
  }
  return found;
}

const triggerOf = (label: string) => text(selectOf(label).findTrigger().getElement());
const errorOf = (label: string) => text(field(label).findError()?.getElement());
const constraintOf = (label: string) => text(field(label).findConstraint()?.getElement());
const descriptionOf = (label: string) => text(field(label).findDescription()?.getElement());

async function chooseVpc(id = 'vpc-x') {
  const select = selectOf('VPC');
  select.openDropdown();
  await waitFor(() => {
    expect(select.findDropdown().findOptionByValue(id)).not.toBeNull();
  });
  select.selectOptionByValue(id);
  await waitFor(() => {
    expect(triggerOf('VPC')).toContain(id);
  });
}

async function chooseZone(zone: string) {
  await waitFor(() => {
    selectOf('Availability Zone - optional').openDropdown();
    expect(selectOf('Availability Zone - optional').findDropdown().findOptionByValue(zone)).not.toBeNull();
  });
  selectOf('Availability Zone - optional').selectOptionByValue(zone);
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Create subnet' }));
}

async function opened() {
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 1, name: 'Create subnet' })).toBeInTheDocument();
  });
}

/** The failure shown on the form, above its buttons (the notice is an alert of the frame). */
function alertText(): string {
  const form = document.querySelector('form');
  return form === null ? '' : text(createWrapper(form).findAlert()?.getElement());
}

/** Lets every answer already given settle. */
async function settled() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('Create subnet', () => {
  it('opens with no VPC, an empty name, "Chosen by the emulator" and an empty block with its description and constraint text', async () => {
    open();
    await opened();
    expect(triggerOf('VPC')).toBe('Choose a VPC');
    expect(inputOf('Name - optional').value).toBe('');
    expect(constraintOf('Name - optional')).toBe(NAME_RULE);
    expect(triggerOf('Availability Zone - optional')).toBe('Chosen by the emulator');
    expect(inputOf('IPv4 CIDR block').value).toBe('');
    expect(descriptionOf('IPv4 CIDR block')).toBe(BLOCK_DESCRIPTION);
    expect(constraintOf('IPv4 CIDR block')).toBe(BLOCK_RULE);
    expect(api.getVpc).not.toHaveBeenCalled();
  });

  it('with ?vpc= of a VPC the emulator holds → that VPC is chosen', async () => {
    open(`${CREATE_PATH}?vpc=vpc-x`);
    await opened();
    await waitFor(() => {
      expect(triggerOf('VPC')).toContain('vpc-x');
    });
    expect(vi.mocked(api.getVpc).mock.calls[0]?.[1]).toBe('vpc-x');
  });

  it('the zones: "Loading Availability Zones", then "Chosen by the emulator" and the three zones', async () => {
    let answer: (zones: string[]) => void = () => undefined;
    vi.mocked(availability.listAvailabilityZones).mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    open();
    await opened();
    expect(await screen.findByText('Loading Availability Zones')).toBeInTheDocument();
    act(() => {
      answer(ZONES);
    });
    await waitFor(() => {
      expect(screen.queryByText('Loading Availability Zones')).toBeNull();
    });
    const select = selectOf('Availability Zone - optional');
    select.openDropdown();
    expect((select.findDropdown().findOptions() ?? []).map((option) => text(option.findLabel().getElement()))).toEqual([
      'Chosen by the emulator',
      ...ZONES,
    ]);
    expect(availability.listAvailabilityZones).toHaveBeenCalledTimes(1);
  });

  it('their read failed → "The Availability Zones could not be loaded" with "Retry", and the form can still be sent', async () => {
    vi.mocked(availability.listAvailabilityZones).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'DescribeAvailabilityZones' }),
    );
    open();
    await opened();
    expect(await screen.findByText('The Availability Zones could not be loaded')).toBeInTheDocument();
    await chooseVpc();
    type('IPv4 CIDR block', '10.0.1.0/24');
    submit();
    await waitFor(() => {
      expect(changes.createSubnet).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(changes.createSubnet).mock.calls[0]?.[1]).toEqual({ vpcId: 'vpc-x', cidr: '10.0.1.0/24' });
  });

  it('"Retry" reads the zones again', async () => {
    vi.mocked(availability.listAvailabilityZones).mockRejectedValueOnce(
      new RequestError({ kind: 'other', operation: 'DescribeAvailabilityZones', code: 'InternalError' }),
    );
    open();
    await opened();
    expect(await screen.findByText('The Availability Zones could not be loaded')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(screen.queryByText('The Availability Zones could not be loaded')).toBeNull();
    });
    expect(availability.listAvailabilityZones).toHaveBeenCalledTimes(2);
  });

  it('a fault → its message at the field and nothing sent', async () => {
    open();
    await opened();
    submit();
    expect(errorOf('VPC')).toBe('Choose a VPC.');
    expect(errorOf('IPv4 CIDR block')).toBe('Enter a CIDR block.');
    type('IPv4 CIDR block', '10.0.1/24');
    expect(errorOf('IPv4 CIDR block')).toBe('Enter an IPv4 block in CIDR notation, such as 10.0.1.0/24.');
    expect(constraintOf('IPv4 CIDR block')).toBe(BLOCK_RULE);
    type('IPv4 CIDR block', '10.0.1.0/29');
    expect(errorOf('IPv4 CIDR block')).toBe("The block's size must be from /16 to /28.");
    type('IPv4 CIDR block', '10.0.0.0/15');
    expect(errorOf('IPv4 CIDR block')).toBe("The block's size must be from /16 to /28.");
    type('Name - optional', 'n'.repeat(257));
    expect(errorOf('Name - optional')).toBe('A name can have up to 256 characters.');
    await chooseVpc();
    submit();
    await settled();
    expect(changes.createSubnet).not.toHaveBeenCalled();
  });

  it('every field filled → one create with the VPC, the name, the zone and the block; the new subnet\'s page with "Created subnet {id}"', async () => {
    const router = open();
    await opened();
    await chooseVpc();
    type('Name - optional', 'web');
    await chooseZone('us-east-1b');
    type('IPv4 CIDR block', '10.0.1.0/24');
    submit();
    await waitFor(() => {
      expect(screen.getByText('Created subnet subnet-0new')).toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe('/aws/vpc/subnets/subnet/subnet-0new');
    expect(changes.createSubnet).toHaveBeenCalledTimes(1);
    expect(vi.mocked(changes.createSubnet).mock.calls[0]?.slice(0, 2)).toEqual([
      ENGINE,
      { vpcId: 'vpc-x', name: 'web', zone: 'us-east-1b', cidr: '10.0.1.0/24' },
    ]);
  });

  it('the zone left → a create with no zone', async () => {
    open();
    await opened();
    await chooseVpc();
    type('IPv4 CIDR block', '10.0.1.0/24');
    submit();
    await waitFor(() => {
      expect(changes.createSubnet).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(changes.createSubnet).mock.calls[0]?.[1]).toEqual({ vpcId: 'vpc-x', cidr: '10.0.1.0/24' });
  });

  it('cancelled from a form opened with ?vpc= and nothing else entered → leaves at once to the subnets list', async () => {
    const router = open(`${CREATE_PATH}?vpc=vpc-x`);
    await opened();
    await waitFor(() => {
      expect(triggerOf('VPC')).toContain('vpc-x');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/subnets');
    });
    expect(screen.queryByText('Discard what you entered?')).toBeNull();
  });

  it('after an entry → the discard dialog; "Discard" leads to the subnets list', async () => {
    const router = open(`${CREATE_PATH}?vpc=vpc-x`);
    await opened();
    await waitFor(() => {
      expect(triggerOf('VPC')).toContain('vpc-x');
    });
    type('IPv4 CIDR block', '10.0.1.0/24');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const shown = await screen.findByRole('dialog');
    expect(text(shown)).toContain('Discard what you entered?');
    expect(router.state.location.pathname).toBe(CREATE_PATH);
    fireEvent.click(within(shown).getByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/subnets');
    });
    expect(changes.createSubnet).not.toHaveBeenCalled();
  });

  it('a refusal → the form stays with the code and message and every entry', async () => {
    const message = "The CIDR '10.9.0.0/24' is invalid.";
    vi.mocked(changes.createSubnet).mockRejectedValue(
      new RequestError({ kind: 'other', operation: 'CreateSubnet', code: 'InvalidSubnet.Range', message }),
    );
    const router = open();
    await opened();
    await chooseVpc();
    type('Name - optional', 'web');
    type('IPv4 CIDR block', '10.9.0.0/24');
    submit();
    await waitFor(() => {
      expect(alertText()).toContain('InvalidSubnet.Range');
    });
    expect(alertText()).toContain(message);
    expect(router.state.location.pathname).toBe(CREATE_PATH);
    expect(inputOf('Name - optional').value).toBe('web');
    expect(inputOf('IPv4 CIDR block').value).toBe('10.9.0.0/24');
    expect(triggerOf('VPC')).toContain('vpc-x');
  });

  it('a 501 → "not implemented by the emulator" with CreateSubnet', async () => {
    vi.mocked(changes.createSubnet).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'CreateSubnet' }),
    );
    open();
    await opened();
    await chooseVpc();
    type('IPv4 CIDR block', '10.0.1.0/24');
    submit();
    await waitFor(() => {
      expect(alertText()).toContain('Not implemented by the emulator');
    });
    expect(alertText()).toContain('CreateSubnet');
  });

  it('while creating, the button reads "Creating" and a second press sends nothing', async () => {
    let finish: (id: string) => void = () => undefined;
    vi.mocked(changes.createSubnet).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    open();
    await opened();
    await chooseVpc();
    type('IPv4 CIDR block', '10.0.1.0/24');
    submit();
    const creating = await screen.findByRole('button', { name: 'Creating' });
    fireEvent.click(creating);
    fireEvent.submit(creating.closest('form') as HTMLFormElement);
    expect(changes.createSubnet).toHaveBeenCalledTimes(1);
    act(() => {
      finish('subnet-0new');
    });
    await waitFor(() => {
      expect(screen.getByText('Created subnet subnet-0new')).toBeInTheDocument();
    });
  });

  it('the page names its resources "subnets" to the frame', async () => {
    open();
    expect(await screen.findByText('These subnets are in your local emulator')).toBeInTheDocument();
  });

  it("after the create, the reads answering in another order → the new subnet's page with the result, settled on the newest read", async () => {
    const reads: { resolve: (read: api.Read<api.Subnet>) => void }[] = [];
    vi.mocked(api.getSubnet).mockImplementation(
      () =>
        new Promise((resolve) => {
          reads.push({ resolve });
        }),
    );
    const router = open();
    await opened();
    await chooseVpc();
    type('IPv4 CIDR block', '10.0.1.0/24');
    submit();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/subnets/subnet/subnet-0new');
    });
    expect(await screen.findByText('Created subnet subnet-0new')).toBeInTheDocument();
    await waitFor(() => {
      expect(reads).toHaveLength(1);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => {
      expect(reads).toHaveLength(2);
    });
    act(() => {
      reads[1]?.resolve({
        found: true,
        value: { ...created('subnet-0new'), tags: [{ key: 'Name', value: 'newest' }] },
      });
    });
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'newest' })).toBeInTheDocument();
    });
    act(() => {
      reads[0]?.resolve({ found: false });
    });
    await settled();
    expect(screen.getByRole('heading', { level: 1, name: 'newest' })).toBeInTheDocument();
    expect(screen.queryByText('Subnet not found')).toBeNull();
    expect(screen.getByText('Created subnet subnet-0new')).toBeInTheDocument();
  });
});
