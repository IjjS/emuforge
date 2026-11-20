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
import * as choices from '../choices-api';
import * as launching from '../launch-api';

// S2 rendered inside the area's layout, with the calls of `choices-api.ts`, `launch-api.ts` and, for the instance's page
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
    listSubnetChoices: vi.fn(),
    listVpcChoices: vi.fn(),
    listGroupChoices: vi.fn(),
    listKeyPairChoices: vi.fn(),
    getDefaultVpc: vi.fn(),
  };
});

vi.mock('../launch-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../launch-api')>();
  return { ...real, launchInstance: vi.fn() };
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
  return router;
}
// ---------------------------------------------------------------------------------------------------------------
// What the emulator holds, as the readers answer it.

const LAUNCH_PATH = '/aws/ec2/instances/launch';
const NAME_RULE = 'Up to 256 characters. Stored as the Name tag.';

const IMAGE: choices.ImageChoice = { id: 'ami-1', name: 'al2023', architecture: 'x86_64', platform: 'Linux/UNIX' };
const TYPE: choices.InstanceTypeChoice = { type: 't3.micro', vcpus: 2, memoryMiB: 1024, architectures: ['x86_64'] };
const SUBNETS: choices.SubnetChoice[] = [
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
  any: [{ id: 'sg-any', name: 'anywhere' }],
};

beforeEach(() => {
  vi.mocked(choices.listImageChoices).mockResolvedValue({ choices: [IMAGE] });
  vi.mocked(choices.listInstanceTypeChoices).mockResolvedValue({ choices: [TYPE] });
  vi.mocked(choices.listKeyPairChoices).mockResolvedValue([{ name: 'dev' }]);
  vi.mocked(choices.listSubnetChoices).mockResolvedValue({ choices: SUBNETS });
  vi.mocked(choices.getDefaultVpc).mockResolvedValue('vpc-d');
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
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 1, name: 'Launch instance' })).toBeInTheDocument();
  });
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
    expect(triggerOf('Key pair - optional')).toBe('No key pair');
    expect(triggerOf('Subnet - optional')).toBe('Chosen by the emulator');
    expect(groupTokens()).toEqual([]);
    expect(text(groupsField().findTrigger().getElement())).toContain('Choose security groups');
    expect(text(field('Security groups - optional').findDescription()?.getElement())).toBe(
      'With none chosen the instance gets the group default.',
    );
    expect(choices.listImageChoices).not.toHaveBeenCalled();
    expect(choices.listKeyPairChoices).not.toHaveBeenCalled();
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
    await choose('Subnet - optional', 'subnet-a');
    await chooseGroup('sg-d1');
    await chooseGroup('sg-d2');
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

  it("no subnet → the default VPC's groups; a subnet → its VPC's; another VPC's subnet clears the groups, the same VPC's keeps them", async () => {
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

    await choose('Subnet - optional', 'subnet-b');
    expect(groupTokens()).toEqual(['web']);
    await choose('Subnet - optional', 'subnet-a');
    expect(groupTokens()).toEqual(['web']);

    await choose('Subnet - optional', 'subnet-x');
    expect(groupTokens()).toEqual([]);
    groupsField().openDropdown();
    await waitFor(() => {
      expect(shownGroups()).toEqual(['other']);
    });
    expect(vi.mocked(choices.listGroupChoices).mock.lastCall?.[1]).toEqual({ vpcId: 'vpc-x' });
    expect(launching.launchInstance).not.toHaveBeenCalled();
  });

  it("with the default VPC's read failed and no subnet → every group offered", async () => {
    vi.mocked(choices.getDefaultVpc).mockRejectedValue(
      new RequestError({ kind: 'access-denied', operation: 'DescribeVpcs', message: 'no' }),
    );
    open();
    await opened();
    groupsField().openDropdown();
    await waitFor(() => {
      expect(shownGroups()).toEqual(['anywhere']);
    });
    expect(vi.mocked(choices.listGroupChoices).mock.calls[0]?.[1]).toEqual({});
  });

  it('"Create key pair" leads to the create-key-pair address', async () => {
    const router = open();
    await opened();
    fireEvent.click(screen.getByRole('link', { name: 'Create key pair' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ec2/key-pairs/create');
    });
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
    await choose('Subnet - optional', 'subnet-x');
    submit();
    await waitFor(() => {
      expect(alertText()).toContain('Unsupported');
    });
    expect(alertText()).toContain(message);
    expect(router.state.location.pathname).toBe(LAUNCH_PATH);
    expect(nameInput().value).toBe('web-1');
    expect(triggerOf('Image')).toContain('al2023');
    expect(triggerOf('Instance type')).toContain('t3.micro');
    expect(triggerOf('Subnet - optional')).toContain('subnet-x');
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

  it('"Cancel" after an entry → the discard dialog; "Keep editing" keeps the form, "Discard" leaves', async () => {
    const router = open();
    await opened();
    await choose('Image', 'ami-1');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Discard what you entered?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe(LAUNCH_PATH);
    expect(triggerOf('Image')).toContain('al2023');
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
