import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import * as api from '../api';
import * as network from '../../../lib/ec2-network-choices';
import * as choices from '../choices-api';
import * as launching from '../launch-api';
import { EC2_KEYS } from '../queries';

// S2 rendered inside the area's layout, with the calls of `choices-api.ts`, `lib/ec2-network-choices.ts`, `launch-api.ts` and, for the instance's page
// the launch leads to, `api.ts` answered by the case (their own tests prove the calls against a fake engine).

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return {
    ...real,
    listInstances: vi.fn(),
    getInstance: vi.fn(),
    getTerminationProtection: vi.fn(),
    actOnInstance: vi.fn(),
  };
});

vi.mock('../choices-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../choices-api')>();
  return {
    ...real,
    listImageChoices: vi.fn(),
    listInstanceTypeChoices: vi.fn(),
    listInstanceTypeOfferings: vi.fn(),
    listGroupChoices: vi.fn(),
    listKeyPairChoices: vi.fn(),
    getDefaultVpc: vi.fn(),
  };
});

vi.mock('../../../lib/ec2-network-choices', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../lib/ec2-network-choices')>();
  return { ...real, listSubnetChoices: vi.fn(), listVpcChoices: vi.fn() };
});

vi.mock('../launch-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../launch-api')>();
  return { ...real, launchInstance: vi.fn() };
});

vi.mock('../instance-profile-choices', async (importOriginal) => {
  const real = await importOriginal<typeof import('../instance-profile-choices')>();
  return {
    ...real,
    instanceProfileChoices: (endpoint: string | undefined) => ({
      ...real.instanceProfileChoices(endpoint),
      read: async () => ({ items: [PROFILE] }),
    }),
  };
});

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

const EMULATOR = { port: 9309, endpoint: 'https://127.0.0.1:9309' };
const connectedResult = (): CheckResult => ({ kind: 'connected', checkedAt: Date.now(), emulator: EMULATOR });

let connection: Connection;
const ENGINE = 'http://127.0.0.1:8309';

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

function open(path = LAUNCH_PATH) {
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
  return Object.assign(router, { client });
}
// ---------------------------------------------------------------------------------------------------------------
// What the emulator holds, as the readers answer it.

const LAUNCH_PATH = '/aws/ec2/instances/launch';
const NAME_RULE = 'Up to 256 characters. Stored as the Name tag.';

const IMAGE: choices.ImageChoice = { id: 'ami-1', name: 'al2023', architecture: 'x86_64', description: 'Amazon Linux' };
const TYPE: choices.InstanceTypeChoice = { type: 't3.micro', vcpus: 2, memoryMiB: 1024, architectures: ['x86_64'] };
const DEFAULT_VPC = { id: 'vpc-d', isDefault: true, cidr: '172.31.0.0/16' };
const OTHER_VPC = { id: 'vpc-x', isDefault: false, cidr: '10.0.0.0/16' };
const PROFILE = { name: 'app-profile', arn: 'arn:aws:iam::123456789012:instance-profile/app-profile', roleCount: 2 };
const SUBNETS: network.SubnetChoice[] = [
  { id: 'subnet-a', vpcId: 'vpc-d', zone: 'us-east-1a', cidr: '172.31.0.0/20' },
  { id: 'subnet-b', vpcId: 'vpc-d', zone: 'us-east-1b', cidr: '172.31.16.0/20' },
  { id: 'subnet-x', vpcId: 'vpc-x', zone: 'us-east-1a', cidr: '10.0.0.0/24' },
];
const GROUPS: Record<string, choices.GroupChoice[]> = {
  'vpc-d': [
    { id: 'sg-d1', name: 'default' },
    { id: 'sg-d2', name: 'web' },
  ],
  'vpc-x': [{ id: 'sg-x1', name: 'other' }],
};

beforeEach(() => {
  vi.mocked(choices.listImageChoices).mockResolvedValue({ choices: [IMAGE] });
  vi.mocked(choices.listInstanceTypeChoices).mockResolvedValue({ choices: [TYPE] });
  vi.mocked(choices.listKeyPairChoices).mockResolvedValue([{ name: 'dev' }]);
  vi.mocked(network.listSubnetChoices).mockImplementation(async (_at, _token, _signal, vpcId) => ({
    choices: SUBNETS.filter((subnet) => subnet.vpcId === vpcId),
  }));
  vi.mocked(network.listVpcChoices).mockResolvedValue({ choices: [DEFAULT_VPC, OTHER_VPC] });
  vi.mocked(choices.getDefaultVpc).mockResolvedValue(DEFAULT_VPC);
  vi.mocked(choices.listInstanceTypeOfferings).mockResolvedValue(new Set([TYPE.type]));
  vi.mocked(api.listInstances).mockResolvedValue({ instances: [] });
  vi.mocked(choices.listGroupChoices).mockImplementation((_at, filters) =>
    Promise.resolve({ choices: GROUPS[filters.vpcId ?? 'any'] ?? [] }),
  );
  vi.mocked(launching.launchInstance).mockResolvedValue('i-0new');
  vi.mocked(api.getInstance).mockResolvedValue({
    found: true,
    instance: { id: 'i-0new', state: 'running', groups: [], volumes: [], tags: [] },
  });
  vi.mocked(api.getTerminationProtection).mockResolvedValue(false);
});

// ---------------------------------------------------------------------------------------------------------------
// The form as a user reads and fills it.

const PAGE = createWrapper(document.body);
const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** The form field whose label is `label`. */
function field(label: string) {
  const found = PAGE.findAllFormFields().find((each) => text(each.findLabel()?.getElement()) === label);
  if (found === undefined) {
    throw new Error(`no field ${label}`);
  }
  return found;
}

function selectIn(label: string) {
  const found = createWrapper(field(label).getElement()).findSelect();
  if (found === null) {
    throw new Error(`no select in ${label}`);
  }
  return found;
}

function groupsField() {
  const found = createWrapper(field('Security groups - optional').getElement()).findMultiselect();
  if (found === null) {
    throw new Error('no multiselect');
  }
  return found;
}

function nameInput(): HTMLInputElement {
  const input = field('Name - optional').getElement().querySelector('input');
  if (input === null) {
    throw new Error('no name input');
  }
  return input;
}

function typeName(value: string) {
  fireEvent.change(nameInput(), { target: { value } });
}

function triggerOf(label: string): string {
  return text(selectIn(label).findTrigger().getElement());
}

function groupTokens(): string[] {
  return (groupsField().findTokens() ?? []).map((token) => text(token.findLabel().getElement()));
}

/** Opens the field `label`, waits for the choice `value` and chooses it. */
async function choose(label: string, value: string) {
  const select = selectIn(label);
  await waitFor(() => expect(select.findTrigger().getElement()).toBeEnabled());
  select.openDropdown();
  await waitFor(() => {
    expect(select.findDropdown().findOptionByValue(value)).not.toBeNull();
  });
  select.selectOptionByValue(value);
}

async function chooseGroup(value: string) {
  const groups = groupsField();
  groups.openDropdown();
  await waitFor(() => {
    expect(groups.findDropdown().findOptionByValue(value)).not.toBeNull();
  });
  groups.selectOptionByValue(value);
  groups.closeDropdown();
}

function shownGroups(): string[] {
  return (groupsField().findDropdown().findOptions() ?? []).map((option) => text(option.findLabel().getElement()));
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Launch instance' }));
}

async function opened() {
  await screen.findByRole('heading', { level: 1, name: 'Launch instance' });
  await waitFor(() => expect(triggerOf('VPC') === 'vpc-d' || !screen.queryByText('Checking VPC')).toBe(true));
}

function enterSettings() {
  fireEvent.click(screen.getByRole('checkbox', { name: 'Termination protection' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'User data - optional' }), { target: { value: 'a\nbé' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Key' }), { target: { value: 'Team' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Value - optional' }), { target: { value: 'Web' } });
}

/** The failure shown on the form, above its buttons (the notice is an alert of the frame). */
function alertText(): string {
  const form = document.querySelector('form');
  return form === null ? '' : text(createWrapper(form).findAlert()?.getElement());
}

describe('Launch instance', () => {
  it('opens with an empty name and its constraint text, no image, no type, "No key pair", "Chosen by the emulator", no group and the default sentence', async () => {
    open();
    await opened();
    expect(nameInput().value).toBe('');
    expect(text(field('Name - optional').findConstraint()?.getElement())).toBe(NAME_RULE);
    expect(triggerOf('Image')).toBe('Choose an image');
    expect(triggerOf('Instance type')).toBe('Choose an instance type');
    expect(triggerOf('Key pair - optional')).toContain('No key pair');
    await waitFor(() => expect(triggerOf('VPC')).toBe('vpc-d'));
    expect(triggerOf('Subnet')).toContain('Chosen by the emulator');
    expect(triggerOf('Subnet')).toContain('The emulator uses a default subnet of the default VPC.');
    expect(groupTokens()).toEqual([]);
    expect(text(groupsField().findTrigger().getElement())).toContain('Choose security groups');
    expect(text(field('Security groups - optional').findDescription()?.getElement())).toBe(
      'With none chosen the instance gets the group default.',
    );
    expect(choices.listImageChoices).not.toHaveBeenCalled();
    expect(choices.listKeyPairChoices).not.toHaveBeenCalled();
  });

  it("the instance type's description names the chosen image's architecture, and nothing of an image before one is chosen", async () => {
    open();
    await opened();
    const hint = "Type part of a type's name to narrow the list.";
    expect(text(field('Instance type').findDescription()?.getElement())).toBe(hint);
    expect(triggerOf('Instance type')).toBe('Choose an instance type');
    await choose('Image', 'ami-1');
    expect(text(field('Instance type').findDescription()?.getElement())).toBe(`The chosen image is x86_64. ${hint}`);
    expect(triggerOf('Instance type')).toBe('Choose an instance type');
  });

  it('"Launch instance" with a fault → its message at the field and nothing sent', async () => {
    open();
    await opened();
    submit();
    expect(text(field('Image').findError()?.getElement())).toBe('Choose an image.');
    expect(text(field('Instance type').findError()?.getElement())).toBe('Choose an instance type.');
    await choose('Image', 'ami-1');
    await choose('Instance type', 't3.micro');
    typeName('n'.repeat(257));
    submit();
    expect(text(field('Name - optional').findError()?.getElement())).toBe('A name can have up to 256 characters.');
    expect(text(field('Name - optional').findConstraint()?.getElement())).toBe(NAME_RULE);
    expect(field('Image').findError()).toBeNull();
    expect(launching.launchInstance).not.toHaveBeenCalled();
  });

  it('every field filled → one launch with those values; the new instance\'s page with "Launched instance {id}"', async () => {
    const router = open();
    await opened();
    typeName('web-1');
    await choose('Image', 'ami-1');
    await choose('Instance type', 't3.micro');
    await choose('Key pair - optional', 'dev');
    await choose('Subnet', 'subnet-a');
    await chooseGroup('sg-d1');
    await chooseGroup('sg-d2');
    await choose('IAM instance profile', PROFILE.name);
    enterSettings();
    submit();
    await waitFor(() => {
      expect(screen.getByText('Launched instance i-0new')).toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe('/aws/ec2/instances/instance/i-0new');
    expect(launching.launchInstance).toHaveBeenCalledTimes(1);
    expect(vi.mocked(launching.launchInstance).mock.calls[0]?.slice(0, 2)).toEqual([
      ENGINE,
      {
        imageId: 'ami-1',
        instanceType: 't3.micro',
        name: 'web-1',
        keyName: 'dev',
        subnetId: 'subnet-a',
        securityGroupIds: ['sg-d1', 'sg-d2'],
        instanceProfileName: PROFILE.name,
        terminationProtection: true,
        userData: 'a\nbé',
        tags: [{ key: 'Team', value: 'Web' }],
      },
    ]);
  });

  it('an image and a type only → a launch with no key, subnet, group or tag', async () => {
    open();
    await opened();
    await choose('Image', 'ami-1');
    await choose('Instance type', 't3.micro');
    submit();
    await waitFor(() => {
      expect(launching.launchInstance).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(launching.launchInstance).mock.calls[0]?.[1]).toEqual({
      imageId: 'ami-1',
      instanceType: 't3.micro',
    });
  });

  it('clears the subnet and groups on a VPC change and restores the implicit subnet on the default VPC', async () => {
    open();
    await opened();
    await waitFor(() => {
      expect(choices.getDefaultVpc).toHaveBeenCalled();
    });
    groupsField().openDropdown();
    await waitFor(() => {
      expect(shownGroups()).toEqual(['default', 'web']);
    });
    expect(vi.mocked(choices.listGroupChoices).mock.calls[0]?.[1]).toEqual({ vpcId: 'vpc-d' });
    groupsField().selectOptionByValue('sg-d2');
    groupsField().closeDropdown();
    expect(groupTokens()).toEqual(['web']);

    await choose('Subnet', 'subnet-b');
    expect(groupTokens()).toEqual(['web']);
    await choose('Subnet', 'subnet-a');
    expect(groupTokens()).toEqual(['web']);

    await choose('VPC', 'vpc-x');
    expect(triggerOf('Subnet')).toBe('Choose a subnet');
    expect(groupTokens()).toEqual([]);
    const subnet = selectIn('Subnet');
    subnet.openDropdown();
    await waitFor(() => expect(subnet.findDropdown().findOptionByValue('subnet-x')).not.toBeNull());
    expect(subnet.findDropdown().findOptionByValue('subnet-a')).toBeNull();
    expect(subnet.findDropdown().findOptionByValue('__fixed__')).toBeNull();
    expect(text(subnet.findDropdown().getElement())).not.toContain('Chosen by the emulator');
    subnet.closeDropdown();
    groupsField().openDropdown();
    await waitFor(() => {
      expect(shownGroups()).toEqual(['other']);
    });
    expect(vi.mocked(choices.listGroupChoices).mock.lastCall?.[1]).toEqual({ vpcId: 'vpc-x' });
    groupsField().closeDropdown();
    await choose('VPC', 'vpc-d');
    expect(triggerOf('Subnet')).toContain('Chosen by the emulator');
    expect(launching.launchInstance).not.toHaveBeenCalled();
  });

  it('locks the subnet and security groups when the emulator has no default VPC', async () => {
    vi.mocked(choices.getDefaultVpc).mockResolvedValue(undefined);
    open();
    await opened();
    expect(triggerOf('VPC')).toBe('Choose a VPC');
    expect(triggerOf('Subnet')).toBe('Choose VPC first');
    expect(selectIn('Subnet').findTrigger().getElement()).toBeDisabled();
    expect(groupsField().findTrigger().getElement()).toBeDisabled();
    expect(network.listSubnetChoices).not.toHaveBeenCalled();
    expect(choices.listGroupChoices).not.toHaveBeenCalled();
  });

  it('allows choosing a VPC and subnet when the default VPC read returns 501', async () => {
    vi.mocked(choices.getDefaultVpc).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'DescribeVpcs' }),
    );
    open();
    await opened();
    expect(await screen.findByText('The emulator answered 501 Not Implemented for DescribeVpcs.')).toBeVisible();
    expect(screen.getAllByText('Not implemented by the emulator')).not.toHaveLength(0);
    expect(triggerOf('VPC')).toBe('Choose a VPC');
    await choose('Image', IMAGE.id);
    await choose('Instance type', TYPE.type);
    submit();
    expect(launching.launchInstance).not.toHaveBeenCalled();
    await choose('VPC', OTHER_VPC.id);
    submit();
    expect(text(field('Subnet').findError()?.getElement())).toBe('Choose a subnet.');
    expect(launching.launchInstance).not.toHaveBeenCalled();
    await choose('Subnet', 'subnet-x');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Launch instance' })).toBeEnabled());
    submit();
    await screen.findByText('Launched instance i-0new');
    expect(launching.launchInstance).toHaveBeenCalledTimes(1);
  });

  it('holds launch while checking the selected subnet, retains an offered type and clears an excluded type', async () => {
    const first = deferred<ReadonlySet<string>>();
    vi.mocked(choices.listInstanceTypeOfferings).mockReturnValueOnce(first.promise).mockResolvedValueOnce(new Set());
    open();
    await opened();
    await choose('Image', IMAGE.id);
    await choose('Instance type', TYPE.type);
    await choose('Subnet', 'subnet-a');
    expect(choices.listInstanceTypeOfferings).toHaveBeenCalledWith(ENGINE, 'us-east-1a', expect.any(AbortSignal));
    expect(triggerOf('Instance type')).toBe(TYPE.type);
    const button = screen.getByRole('button', { name: 'Launch instance' });
    expect(button).toBeDisabled();
    expect(screen.getByText('Checking Instance type')).toBeVisible();
    fireEvent.submit(button.closest('form') as HTMLFormElement);
    expect(launching.launchInstance).not.toHaveBeenCalled();
    await act(async () => first.resolve(new Set([TYPE.type])));
    await waitFor(() => expect(button).toBeEnabled());
    expect(triggerOf('Instance type')).toBe(TYPE.type);
    await choose('Subnet', 'subnet-b');
    await waitFor(() => expect(triggerOf('Instance type')).toBe('Choose an instance type'));
    const types = selectIn('Instance type');
    types.openDropdown();
    expect(await screen.findByText('No instance types in us-east-1b')).toBeVisible();
    expect(types.findDropdown().findOptionByValue(TYPE.type)).toBeNull();
  });

  it('reports a failed offerings read with Retry and prevents launch until it succeeds', async () => {
    vi.mocked(choices.listInstanceTypeOfferings).mockRejectedValueOnce(
      new RequestError({
        kind: 'other',
        operation: 'DescribeInstanceTypeOfferings',
        code: 'InternalError',
        message: 'boom',
      }),
    );
    open();
    await opened();
    await choose('Image', IMAGE.id);
    await choose('Instance type', TYPE.type);
    await choose('Subnet', 'subnet-a');
    expect(await screen.findByText('The instance types could not be read')).toBeVisible();
    const types = selectIn('Instance type');
    types.openDropdown();
    expect(await screen.findByText('Instance types unavailable')).toBeVisible();
    expect(types.findDropdown().findOptionByValue(TYPE.type)).toBeNull();
    types.closeDropdown();
    submit();
    expect(launching.launchInstance).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Launch instance' })).toBeEnabled());
    expect(launching.launchInstance).not.toHaveBeenCalled();
  });

  it('reports a 501 at the type field and offers no instance type', async () => {
    vi.mocked(choices.listInstanceTypeOfferings).mockRejectedValueOnce(
      new RequestError({ kind: 'not-implemented', operation: 'DescribeInstanceTypeOfferings' }),
    );
    open();
    await opened();
    await choose('Subnet', 'subnet-a');
    expect(
      await screen.findByText('The emulator answered 501 Not Implemented for DescribeInstanceTypeOfferings.'),
    ).toBeVisible();
    expect(screen.getAllByText('Not implemented by the emulator')).not.toHaveLength(0);
    const types = selectIn('Instance type');
    types.openDropdown();
    expect(await screen.findByText('Instance types unavailable')).toBeVisible();
    expect(types.findDropdown().findOptionByValue(TYPE.type)).toBeNull();
    expect(choices.listInstanceTypeChoices).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('reads the images again when the field is reopened without moving focus', async () => {
    open();
    await opened();
    const images = selectIn('Image');
    images.openDropdown();
    await waitFor(() => expect(images.findDropdown().findOptionByValue(IMAGE.id)).not.toBeNull());
    images.closeDropdown();
    vi.mocked(choices.listImageChoices).mockResolvedValue({ choices: [IMAGE, { id: 'ami-new', name: 'new' }] });
    images.openDropdown();
    await waitFor(() => expect(images.findDropdown().findOptionByValue('ami-new')).not.toBeNull());
    expect(choices.listImageChoices).toHaveBeenCalledTimes(2);
  });

  it('shows the instance profile options and launch settings', async () => {
    open();
    await opened();
    expect(triggerOf('IAM instance profile')).toContain('No instance profile');
    expect(triggerOf('IAM instance profile')).toContain('The instance is launched without one.');
    const profile = selectIn('IAM instance profile');
    profile.openDropdown();
    await waitFor(() => {
      expect(profile.findDropdown().findOptionByValue(PROFILE.name)?.getElement()).toHaveTextContent('2 roles');
    });
    expect(screen.getByRole('checkbox', { name: 'Termination protection' })).toBeVisible();
    expect(screen.getByText('While it is on, the emulator refuses to terminate the instance.')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'User data - optional' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Tags - optional' })).toBeVisible();
  });

  it('keeps the launched instance and result when an earlier list read answers after the detail reads', async () => {
    const list = deferred<unknown[]>();
    const detail = deferred<api.InstanceRead>();
    const protection = deferred<boolean>();
    const router = open();
    await opened();
    let earlierSignal: AbortSignal | undefined;
    const listRead = ({ signal }: { signal: AbortSignal }) => {
      earlierSignal = signal;
      return list.promise;
    };
    const beforeLaunch = router.client
      .fetchQuery({ queryKey: EC2_KEYS.instances('earlier'), queryFn: listRead })
      .catch(() => undefined);
    vi.mocked(api.getInstance).mockReturnValue(detail.promise);
    vi.mocked(api.getTerminationProtection).mockReturnValue(protection.promise);
    await choose('Image', IMAGE.id);
    await choose('Instance type', TYPE.type);
    submit();
    expect(await screen.findByText('Launched instance i-0new')).toBeVisible();
    expect(earlierSignal?.aborted).toBe(true);
    await act(async () => protection.resolve(true));
    await act(async () =>
      detail.resolve({
        found: true,
        instance: { id: 'i-0new', state: 'running', groups: [], volumes: [], tags: [] },
      }),
    );
    expect(await screen.findByRole('heading', { name: 'i-0new' })).toBeVisible();
    await act(async () => {
      list.resolve([]);
      await beforeLaunch;
    });
    expect(router.state.location.pathname).toBe('/aws/ec2/instances/instance/i-0new');
    expect(screen.getByText('Launched instance i-0new')).toBeVisible();
  });

  it('"Create key pair" leads to the create-key-pair address, in a new tab, and the form keeps what was entered', async () => {
    const router = open();
    await opened();
    typeName('web-1');
    const link = screen.getByRole('link', { name: /^Create key pair/ });
    expect(link.getAttribute('href')).toBe('/aws/ec2/key-pairs/create');
    expect(link.getAttribute('target')).toBe('_blank');
    fireEvent.click(link);
    expect(router.state.location.pathname).toBe(LAUNCH_PATH);
    expect(nameInput().value).toBe('web-1');
  });

  it('the key pairs are read again when the field is next opened, so a key made meanwhile can be chosen', async () => {
    open();
    await opened();
    const keys = selectIn('Key pair - optional');
    keys.openDropdown();
    await waitFor(() => {
      expect(keys.findDropdown().findOptionByValue('dev')).not.toBeNull();
    });
    keys.closeDropdown();
    // Away to the new tab and back: focus leaves the field and comes back to it before it is opened.
    screen.getByRole('link', { name: /^Create key pair/ }).focus();
    vi.mocked(choices.listKeyPairChoices).mockResolvedValue([{ name: 'dev' }, { name: 'made-elsewhere' }]);
    keys.findTrigger().focus();
    keys.openDropdown();
    await waitFor(() => {
      expect(keys.findDropdown().findOptionByValue('made-elsewhere')).not.toBeNull();
    });
    expect(choices.listKeyPairChoices).toHaveBeenCalledTimes(2);
    keys.selectOptionByValue('made-elsewhere');
    expect(triggerOf('Key pair - optional')).toContain('made-elsewhere');
  });

  it('a refusal → the form stays with the code and message and every entry', async () => {
    const message =
      'Your requested instance type (t3.micro) is not supported in your requested Availability Zone (us-east-1c).';
    vi.mocked(launching.launchInstance).mockRejectedValue(
      new RequestError({ kind: 'other', operation: 'RunInstances', code: 'Unsupported', message }),
    );
    const router = open();
    await opened();
    typeName('web-1');
    await choose('Image', 'ami-1');
    await choose('Instance type', 't3.micro');
    await choose('VPC', OTHER_VPC.id);
    await choose('Subnet', 'subnet-x');
    await chooseGroup('sg-x1');
    await choose('Key pair - optional', 'dev');
    await choose('IAM instance profile', PROFILE.name);
    enterSettings();
    submit();
    await waitFor(() => {
      expect(alertText()).toContain('Unsupported');
    });
    expect(alertText()).toContain(message);
    expect(router.state.location.pathname).toBe(LAUNCH_PATH);
    expect(nameInput().value).toBe('web-1');
    expect(triggerOf('Image')).toContain('al2023');
    expect(triggerOf('Instance type')).toContain('t3.micro');
    expect(triggerOf('VPC')).toContain(OTHER_VPC.id);
    expect(triggerOf('Subnet')).toContain('subnet-x');
    expect(triggerOf('Key pair - optional')).toBe('dev');
    expect(triggerOf('IAM instance profile')).toBe(PROFILE.name);
    expect(groupTokens()).toEqual(['other']);
    expect(screen.getByRole('checkbox', { name: 'Termination protection' })).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'User data - optional' })).toHaveValue('a\nbé');
    expect(screen.getByRole('textbox', { name: 'Key' })).toHaveValue('Team');
    expect(screen.getByRole('textbox', { name: 'Value - optional' })).toHaveValue('Web');
  });

  it('a 501 → "not implemented by the emulator" with RunInstances', async () => {
    vi.mocked(launching.launchInstance).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'RunInstances' }),
    );
    open();
    await opened();
    await choose('Image', 'ami-1');
    await choose('Instance type', 't3.micro');
    submit();
    await waitFor(() => {
      expect(alertText()).toContain('Not implemented by the emulator');
    });
    expect(alertText()).toContain('RunInstances');
  });

  it('while launching, the button reads "Launching" and a second press sends nothing', async () => {
    let finish: (id: string) => void = () => undefined;
    vi.mocked(launching.launchInstance).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    open();
    await opened();
    await choose('Image', 'ami-1');
    await choose('Instance type', 't3.micro');
    submit();
    const launchingButton = await screen.findByRole('button', { name: 'Launching' });
    fireEvent.click(launchingButton);
    fireEvent.submit(launchingButton.closest('form') as HTMLFormElement);
    expect(launching.launchInstance).toHaveBeenCalledTimes(1);
    act(() => {
      finish('i-0new');
    });
    await waitFor(() => {
      expect(screen.getByText('Launched instance i-0new')).toBeInTheDocument();
    });
  });

  it('a choice list that failed to load does not keep the form from being sent', async () => {
    vi.mocked(choices.listKeyPairChoices).mockRejectedValue(
      new RequestError({ kind: 'other', operation: 'DescribeKeyPairs', code: 'InternalError', message: 'boom' }),
    );
    open();
    await opened();
    selectIn('Key pair - optional').openDropdown();
    await waitFor(() => {
      expect(text(selectIn('Key pair - optional').findDropdown().getElement())).toContain(
        'The key pairs could not be loaded',
      );
    });
    await choose('Image', 'ami-1');
    await choose('Instance type', 't3.micro');
    submit();
    await waitFor(() => {
      expect(launching.launchInstance).toHaveBeenCalledTimes(1);
    });
  });

  it('"Cancel" with nothing entered → the instances list at once', async () => {
    const router = open();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ec2/instances');
    });
    expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument();
  });

  it('"Cancel" after changing the VPC → the discard dialog; "Keep editing" keeps the form, "Discard" leaves', async () => {
    const router = open();
    await opened();
    await choose('VPC', OTHER_VPC.id);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Discard what you entered?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe(LAUNCH_PATH);
    expect(triggerOf('VPC')).toContain(OTHER_VPC.id);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ec2/instances');
    });
    expect(launching.launchInstance).not.toHaveBeenCalled();
  });

  it('the page names its resources "instances" to the frame', async () => {
    open();
    await opened();
    expect(await screen.findByText('These instances are in your local emulator')).toBeInTheDocument();
  });
});
