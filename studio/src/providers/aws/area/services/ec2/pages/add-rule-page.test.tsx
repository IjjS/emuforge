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
import * as choices from '../choices-api';
import * as groups from '../group-api';
import * as forms from '../group-form-api';
import { EC2_KEYS } from '../queries';

// S7 rendered inside the area's layout, with the calls of `group-api.ts` (the group's read, and the group's page the
// add leads to), `choices-api.ts` and `group-form-api.ts` answered by the case (their own tests prove the calls
// against a fake engine).

vi.mock('../choices-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../choices-api')>();
  return { ...real, listGroupChoices: vi.fn() };
});

vi.mock('../group-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../group-api')>();
  return { ...real, getSecurityGroup: vi.fn(), listSecurityGroupRules: vi.fn(), listSecurityGroups: vi.fn() };
});

vi.mock('../group-form-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../group-form-api')>();
  return { ...real, addSecurityGroupRule: vi.fn() };
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

const EMULATOR = { port: 9312, endpoint: 'https://127.0.0.1:9312' };
const connectedResult = (): CheckResult => ({ kind: 'connected', checkedAt: Date.now(), emulator: EMULATOR });

let connection: Connection;
const ENGINE = 'http://127.0.0.1:8312';

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

function open(path = ADD_RULE_PATH) {
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

const GROUP_PATH = '/aws/ec2/security-groups/group/sg-1';
const ADD_RULE_PATH = `${GROUP_PATH}/add-rule`;
const FIRST_RULE = '0 to 65535.';
const LAST_RULE = '0 to 65535, not below the first port. Leave empty for one port.';

const GROUP: groups.SecurityGroup = { id: 'sg-1', name: 'web', description: 'Web servers', vpcId: 'vpc-x' };

beforeEach(() => {
  vi.mocked(groups.getSecurityGroup).mockResolvedValue({ found: true, group: GROUP });
  vi.mocked(groups.listSecurityGroupRules).mockResolvedValue({ rules: [] });
  vi.mocked(choices.listGroupChoices).mockImplementation((_at, filters) =>
    Promise.resolve({
      choices:
        filters.vpcId === 'vpc-x'
          ? [
              { id: 'sg-1', name: 'web' },
              { id: 'sg-2', name: 'app', description: 'Application servers' },
            ]
          : [{ id: 'sg-other', name: 'elsewhere' }],
    }),
  );
  vi.mocked(forms.addSecurityGroupRule).mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------------------------------------------
// The form as a user reads and fills it.

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

const PAGE = createWrapper(document.body);
const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function findField(label: string) {
  return PAGE.findAllFormFields().find((each) => text(each.findLabel()?.getElement()) === label);
}

/** The form field whose label is `label`. */
function field(label: string) {
  const found = findField(label);
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

function radio(label: string, value: string) {
  const group = createWrapper(field(label).getElement()).findRadioGroup();
  if (group === null) {
    throw new Error(`no radio group ${label}`);
  }
  return group.findInputByValue(value);
}

function chooseRadio(label: string, value: string) {
  const input = radio(label, value);
  if (input === null) {
    throw new Error(`no ${value} in ${label}`);
  }
  input.click();
}

function selectIn(label: string) {
  const found = createWrapper(field(label).getElement()).findSelect();
  if (found === null) {
    throw new Error(`no select in ${label}`);
  }
  return found;
}

function protocol(value: string) {
  const select = selectIn('Protocol');
  select.openDropdown();
  select.selectOptionByValue(value);
}

const errorOf = (label: string) => text(field(label).findError()?.getElement());
const constraintOf = (label: string) => text(field(label).findConstraint()?.getElement());

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
}

async function opened() {
  await waitFor(() => {
    expect(screen.getByText('Adds a rule to web.')).toBeInTheDocument();
  });
}

/** The failure shown on the form, above its buttons (the notice is an alert of the frame). */
function alertText(): string {
  const form = document.querySelector('form');
  return form === null ? '' : text(createWrapper(form).findAlert()?.getElement());
}

function fillSsh() {
  type('First port', '22');
  type('CIDR block', '10.0.0.0/16');
}

describe('Add rule', () => {
  it('opens on Inbound, TCP, empty ports with their constraint texts, "Source" "IPv4 range" with its placeholder; the description names the group', async () => {
    open();
    await opened();
    expect(screen.getByRole('heading', { level: 1, name: 'Add rule' })).toBeInTheDocument();
    expect(groups.getSecurityGroup).toHaveBeenCalledWith(ENGINE, 'sg-1', expect.anything());
    expect(radio('Direction', 'inbound')?.getElement()).toBeChecked();
    expect(text(selectIn('Protocol').findTrigger().getElement())).toContain('TCP');
    expect(inputOf('First port').value).toBe('');
    expect(inputOf('Last port - optional').value).toBe('');
    expect(constraintOf('First port')).toBe(FIRST_RULE);
    expect(constraintOf('Last port - optional')).toBe(LAST_RULE);
    expect(radio('Source', 'ipv4')?.getElement()).toBeChecked();
    expect(inputOf('CIDR block').placeholder).toBe('10.0.0.0/16');
  });

  it('"Outbound" → "Destination"; "IPv6 range" → its placeholder; "Security group" → the choice field of the group\'s VPC', async () => {
    open();
    await opened();
    chooseRadio('Direction', 'outbound');
    expect(findField('Source')).toBeUndefined();
    chooseRadio('Destination', 'ipv6');
    expect(inputOf('CIDR block').placeholder).toBe('2001:db8::/32');
    chooseRadio('Destination', 'group');
    expect(findField('CIDR block')).toBeUndefined();
    const select = selectIn('Security group');
    expect(text(select.findTrigger().getElement())).toBe('Choose a security group');
    select.openDropdown();
    await waitFor(() => {
      expect(select.findDropdown().findOptionByValue('sg-2')).not.toBeNull();
    });
    const peer = text(select.findDropdown().findOptionByValue('sg-2')?.getElement());
    expect(peer).toContain('app');
    expect(peer).toContain('sg-2 · Application servers');
    expect(select.findDropdown().findOptionByValue('sg-other')).toBeNull();
    expect(vi.mocked(choices.listGroupChoices).mock.calls[0]?.[1]).toEqual({ vpcId: 'vpc-x' });
  });

  it('"ICMP" and "All" → no port field', async () => {
    open();
    await opened();
    for (const value of ['icmp', 'all']) {
      protocol(value);
      expect(findField('First port')).toBeUndefined();
      expect(findField('Last port - optional')).toBeUndefined();
    }
    protocol('udp');
    expect(findField('First port')).toBeDefined();
  });

  it('describes each direction, protocol and peer kind', async () => {
    open();
    await opened();
    for (const description of [
      "The rule is added to the group's inbound rules.",
      "The rule is added to the group's outbound rules.",
      'A range of IPv4 addresses.',
      'A range of IPv6 addresses.',
      'The members of a security group of this VPC.',
    ]) {
      expect(screen.getByText(description)).toBeVisible();
    }

    const select = selectIn('Protocol');
    select.openDropdown();
    for (const [value, description] of [
      ['tcp', 'TCP, for a range of ports.'],
      ['udp', 'UDP, for a range of ports.'],
      ['icmp', 'Every ICMP type and code.'],
      ['all', 'Every protocol and every port.'],
    ] as const) {
      expect(text(select.findDropdown().findOptionByValue(value)?.getElement())).toContain(description);
    }
  });

  it.each(['inbound', 'outbound'] as const)('sends a rule tag with the %s request', async (direction) => {
    open();
    await opened();
    chooseRadio('Direction', direction);
    fillSsh();
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Key' }), { target: { value: 'use' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Value - optional' }), { target: { value: 'ssh' } });
    submit();

    expect(await screen.findByText(`Added an ${direction} rule to web`)).toBeVisible();
    expect(forms.addSecurityGroupRule).toHaveBeenCalledExactlyOnceWith(
      ENGINE,
      'sg-1',
      {
        egress: direction === 'outbound',
        protocol: 'tcp',
        fromPort: 22,
        peer: { kind: 'ipv4', value: '10.0.0.0/16' },
        tags: [{ key: 'use', value: 'ssh' }],
      },
      expect.any(AbortSignal),
    );
  });

  it('keeps the new rule and result when an earlier rules read answers last', async () => {
    const rules = deferred<groups.RulePage>();
    const router = open();
    await opened();
    let rulesSignal: AbortSignal | undefined;
    const oldRead = router.client
      .fetchQuery({
        queryKey: EC2_KEYS.rules('sg-1'),
        queryFn: ({ signal }) => {
          rulesSignal = signal;
          return rules.promise;
        },
      })
      .catch(() => undefined);
    vi.mocked(groups.listSecurityGroupRules).mockResolvedValue({
      rules: [{ id: 'sgr-new', egress: false, protocol: 'tcp', fromPort: 22, description: 'New rule' }],
    });
    fillSsh();
    submit();

    expect(await screen.findByText('New rule')).toBeVisible();
    expect(rulesSignal?.aborted).toBe(true);
    await act(async () => {
      rules.resolve({ rules: [] });
      await oldRead;
    });
    expect(router.state.location.pathname).toBe(GROUP_PATH);
    expect(screen.getByText('Added an inbound rule to web')).toBeVisible();
    expect(screen.getByText('New rule')).toBeVisible();
  });

  it('a fault → its message at the field and nothing sent', async () => {
    open();
    await opened();
    submit();
    expect(errorOf('First port')).toBe('Enter a port.');
    expect(errorOf('CIDR block')).toBe('Enter a CIDR block.');
    type('First port', '80');
    type('Last port - optional', '79');
    type('Description - optional', '50%');
    submit();
    expect(errorOf('Last port - optional')).toBe('The last port cannot be below the first.');
    expect(errorOf('Description - optional')).toBe(
      'A description can hold letters, digits, spaces and ._-:/()#,@[]+=&;{}!$* only.',
    );
    chooseRadio('Source', 'group');
    submit();
    expect(errorOf('Security group')).toBe('Choose a security group.');
    expect(forms.addSecurityGroupRule).not.toHaveBeenCalled();
  });

  it('an inbound TCP rule from a range with a description → sent so; the group\'s page with "Added an inbound rule to {name}"', async () => {
    const router = open();
    await opened();
    fillSsh();
    type('Description - optional', 'SSH');
    submit();
    await waitFor(() => {
      expect(screen.getByText('Added an inbound rule to web')).toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe(GROUP_PATH);
    expect(vi.mocked(forms.addSecurityGroupRule).mock.calls[0]?.slice(0, 3)).toEqual([
      ENGINE,
      'sg-1',
      {
        egress: false,
        protocol: 'tcp',
        fromPort: 22,
        peer: { kind: 'ipv4', value: '10.0.0.0/16' },
        description: 'SSH',
      },
    ]);
  });

  it('an outbound rule to a group → "Added an outbound rule to {name}"', async () => {
    open();
    await opened();
    chooseRadio('Direction', 'outbound');
    protocol('all');
    chooseRadio('Destination', 'group');
    const select = selectIn('Security group');
    select.openDropdown();
    await waitFor(() => {
      expect(select.findDropdown().findOptionByValue('sg-2')).not.toBeNull();
    });
    select.selectOptionByValue('sg-2');
    submit();
    await waitFor(() => {
      expect(screen.getByText('Added an outbound rule to web')).toBeInTheDocument();
    });
    expect(vi.mocked(forms.addSecurityGroupRule).mock.calls[0]?.[2]).toEqual({
      egress: true,
      protocol: 'all',
      peer: { kind: 'group', value: 'sg-2' },
    });
  });

  it('a refusal → the form stays with the code and message and every entry', async () => {
    const message = 'the specified rule "peer: 10.0.0.0/16, TCP, from port: 22, to port: 22, ALLOW" already exists';
    vi.mocked(forms.addSecurityGroupRule).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'AuthorizeSecurityGroupIngress',
        code: 'InvalidPermission.Duplicate',
        message,
      }),
    );
    const router = open();
    await opened();
    fillSsh();
    type('Description - optional', 'SSH');
    submit();
    await waitFor(() => {
      expect(alertText()).toContain('InvalidPermission.Duplicate');
    });
    expect(alertText()).toContain(message);
    expect(router.state.location.pathname).toBe(ADD_RULE_PATH);
    expect(inputOf('First port').value).toBe('22');
    expect(inputOf('CIDR block').value).toBe('10.0.0.0/16');
    expect(inputOf('Description - optional').value).toBe('SSH');
  });

  it('a 501 → "not implemented by the emulator" with the operation\'s name', async () => {
    vi.mocked(forms.addSecurityGroupRule).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'AuthorizeSecurityGroupEgress' }),
    );
    open();
    await opened();
    chooseRadio('Direction', 'outbound');
    fillSsh();
    submit();
    await waitFor(() => {
      expect(alertText()).toContain('Not implemented by the emulator');
    });
    expect(alertText()).toContain('AuthorizeSecurityGroupEgress');
  });

  it('while adding, the button reads "Adding" and a second press sends nothing', async () => {
    let finish: () => void = () => undefined;
    vi.mocked(forms.addSecurityGroupRule).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => {
            resolve(undefined);
          };
        }),
    );
    open();
    await opened();
    fillSsh();
    submit();
    const adding = await screen.findByRole('button', { name: 'Adding' });
    fireEvent.click(adding);
    fireEvent.submit(adding.closest('form') as HTMLFormElement);
    expect(forms.addSecurityGroupRule).toHaveBeenCalledTimes(1);
    act(() => {
      finish();
    });
    await waitFor(() => {
      expect(screen.getByText('Added an inbound rule to web')).toBeInTheDocument();
    });
  });

  it('a group the emulator does not hold → "Security group not found" with "View security groups", and no form', async () => {
    vi.mocked(groups.getSecurityGroup).mockResolvedValue({ found: false });
    open();
    expect(await screen.findByText('Security group not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View security groups' })).toHaveAttribute(
      'href',
      '/aws/ec2/security-groups',
    );
    expect(document.querySelector('form')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add rule' })).not.toBeInTheDocument();
  });

  it('"Cancel" with nothing changed → the group\'s page at once', async () => {
    const router = open();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(GROUP_PATH);
    });
    expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument();
  });

  it('"Cancel" after a change → the discard dialog; "Keep editing" keeps the form, "Discard" leaves', async () => {
    const router = open();
    await opened();
    chooseRadio('Direction', 'outbound');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Discard what you entered?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe(ADD_RULE_PATH);
    expect(radio('Direction', 'outbound')?.getElement()).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(GROUP_PATH);
    });
    expect(forms.addSecurityGroupRule).not.toHaveBeenCalled();
  });

  it('the page names its resources "security groups" to the frame', async () => {
    open();
    await opened();
    expect(await screen.findByText('These security groups are in your local emulator')).toBeInTheDocument();
  });
});
