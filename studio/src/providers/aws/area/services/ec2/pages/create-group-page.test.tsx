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
import * as network from '../../../lib/ec2-network-choices';
import * as groups from '../group-api';
import * as forms from '../group-form-api';

// S5 rendered inside the area's layout, with the calls of `lib/ec2-network-choices.ts`, `group-form-api.ts` and, for the group's
// page the create leads to, `group-api.ts` answered by the case (their own tests prove the calls against a fake
// engine).

vi.mock('../../../lib/ec2-network-choices', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../lib/ec2-network-choices')>();
  return { ...real, listVpcChoices: vi.fn() };
});

vi.mock('../group-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../group-api')>();
  return { ...real, getSecurityGroup: vi.fn(), listSecurityGroupRules: vi.fn(), listSecurityGroups: vi.fn() };
});

vi.mock('../group-form-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../group-form-api')>();
  return { ...real, createSecurityGroup: vi.fn() };
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

const EMULATOR = { port: 9311, endpoint: 'https://127.0.0.1:9311' };
const connectedResult = (): CheckResult => ({ kind: 'connected', checkedAt: Date.now(), emulator: EMULATOR });

let connection: Connection;
const ENGINE = 'http://127.0.0.1:8311';

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

const CREATE_PATH = '/aws/ec2/security-groups/create';
const NAME_RULE = '1 to 255 characters: letters, digits, spaces and ._-:/()#,@[]+=&;{}!$*. It cannot start with sg-.';
const DESCRIPTION_RULE = '1 to 255 characters: letters, digits, spaces and ._-:/()#,@[]+=&;{}!$*.';

const VPCS: network.VpcChoice[] = [
  { id: 'vpc-d', cidr: '172.31.0.0/16', isDefault: true },
  { id: 'vpc-x', cidr: '10.0.0.0/16', isDefault: false },
];

beforeEach(() => {
  vi.mocked(network.listVpcChoices).mockResolvedValue({ choices: VPCS });
  vi.mocked(forms.createSecurityGroup).mockResolvedValue('sg-0new');
  vi.mocked(groups.getSecurityGroup).mockResolvedValue({
    found: true,
    group: { id: 'sg-0new', name: 'web', description: 'Web servers', vpcId: 'vpc-d' },
  });
  vi.mocked(groups.listSecurityGroupRules).mockResolvedValue({ rules: [] });
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

function vpcSelect() {
  const found = createWrapper(field('VPC - optional').getElement()).findSelect();
  if (found === null) {
    throw new Error('no VPC select');
  }
  return found;
}

const errorOf = (label: string) => text(field(label).findError()?.getElement());
const constraintOf = (label: string) => text(field(label).findConstraint()?.getElement());

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Create security group' }));
}

async function opened() {
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 1, name: 'Create security group' })).toBeInTheDocument();
  });
}

/** The failure shown on the form, above its buttons (the notice is an alert of the frame). */
function alertText(): string {
  const form = document.querySelector('form');
  return form === null ? '' : text(createWrapper(form).findAlert()?.getElement());
}

function fill() {
  type('Name', 'web');
  type('Description', 'Web servers');
}

describe('Create security group', () => {
  it('opens with an empty name and description, each with its constraint text, and "The default VPC"', async () => {
    open();
    await opened();
    expect(inputOf('Name').value).toBe('');
    expect(inputOf('Description').value).toBe('');
    expect(constraintOf('Name')).toBe(NAME_RULE);
    expect(constraintOf('Description')).toBe(DESCRIPTION_RULE);
    expect(text(vpcSelect().findTrigger().getElement())).toBe('The default VPC');
    expect(network.listVpcChoices).not.toHaveBeenCalled();
  });

  it('a fault → its message at the field, the constraint text beside it, nothing sent', async () => {
    open();
    await opened();
    submit();
    expect(errorOf('Name')).toBe('Enter a name.');
    expect(errorOf('Description')).toBe('Enter a description.');
    type('Name', 'sg-web');
    type('Description', 'café');
    submit();
    expect(errorOf('Name')).toBe('A name cannot start with sg-.');
    expect(constraintOf('Name')).toBe(NAME_RULE);
    expect(errorOf('Description')).toBe(
      'A description can hold letters, digits, spaces and ._-:/()#,@[]+=&;{}!$* only.',
    );
    expect(constraintOf('Description')).toBe(DESCRIPTION_RULE);
    expect(forms.createSecurityGroup).not.toHaveBeenCalled();
  });

  it('a name and a description → created with no VpcId; the new group\'s page with "Created security group {name}"', async () => {
    const router = open();
    await opened();
    fill();
    submit();
    await waitFor(() => {
      expect(screen.getByText('Created security group web')).toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe('/aws/ec2/security-groups/group/sg-0new');
    expect(forms.createSecurityGroup).toHaveBeenCalledTimes(1);
    expect(vi.mocked(forms.createSecurityGroup).mock.calls[0]?.slice(0, 2)).toEqual([
      ENGINE,
      { name: 'web', description: 'Web servers' },
    ]);
  });

  it('a VPC chosen (its ID, CIDR block and "Default" in the list) → created in it', async () => {
    open();
    await opened();
    fill();
    const select = vpcSelect();
    select.openDropdown();
    await waitFor(() => {
      expect(select.findDropdown().findOptionByValue('vpc-x')).not.toBeNull();
    });
    const shown = text(select.findDropdown().findOptionByValue('vpc-d')?.getElement());
    expect(shown).toContain('vpc-d');
    expect(shown).toContain('172.31.0.0/16');
    expect(shown).toContain('Default');
    expect(text(select.findDropdown().findOptionByValue('vpc-x')?.getElement())).not.toContain('Default');
    select.selectOptionByValue('vpc-x');
    submit();
    await waitFor(() => {
      expect(forms.createSecurityGroup).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(forms.createSecurityGroup).mock.calls[0]?.[1]).toEqual({
      name: 'web',
      description: 'Web servers',
      vpcId: 'vpc-x',
    });
  });

  it('a refusal → the form stays with the code and message and every entry', async () => {
    const message = "The security group 'web' already exists for VPC 'vpc-d'";
    vi.mocked(forms.createSecurityGroup).mockRejectedValue(
      new RequestError({ kind: 'other', operation: 'CreateSecurityGroup', code: 'InvalidGroup.Duplicate', message }),
    );
    const router = open();
    await opened();
    fill();
    submit();
    await waitFor(() => {
      expect(alertText()).toContain('InvalidGroup.Duplicate');
    });
    expect(alertText()).toContain(message);
    expect(router.state.location.pathname).toBe(CREATE_PATH);
    expect(inputOf('Name').value).toBe('web');
    expect(inputOf('Description').value).toBe('Web servers');
  });

  it('a 501 → "not implemented by the emulator" with CreateSecurityGroup', async () => {
    vi.mocked(forms.createSecurityGroup).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'CreateSecurityGroup' }),
    );
    open();
    await opened();
    fill();
    submit();
    await waitFor(() => {
      expect(alertText()).toContain('Not implemented by the emulator');
    });
    expect(alertText()).toContain('CreateSecurityGroup');
  });

  it('while creating, the button reads "Creating" and a second press sends nothing', async () => {
    let finish: (id: string) => void = () => undefined;
    vi.mocked(forms.createSecurityGroup).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    open();
    await opened();
    fill();
    submit();
    const creating = await screen.findByRole('button', { name: 'Creating' });
    fireEvent.click(creating);
    fireEvent.submit(creating.closest('form') as HTMLFormElement);
    expect(forms.createSecurityGroup).toHaveBeenCalledTimes(1);
    act(() => {
      finish('sg-0new');
    });
    await waitFor(() => {
      expect(screen.getByText('Created security group web')).toBeInTheDocument();
    });
  });

  it('"Cancel" with nothing entered → the groups list at once', async () => {
    vi.mocked(groups.listSecurityGroups).mockResolvedValue({ groups: [] });
    const router = open();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ec2/security-groups');
    });
    expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument();
  });

  it('"Cancel" after an entry → the discard dialog; "Keep editing" keeps the form, "Discard" leaves', async () => {
    vi.mocked(groups.listSecurityGroups).mockResolvedValue({ groups: [] });
    const router = open();
    await opened();
    type('Name', 'web');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Discard what you entered?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe(CREATE_PATH);
    expect(inputOf('Name').value).toBe('web');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ec2/security-groups');
    });
    expect(forms.createSecurityGroup).not.toHaveBeenCalled();
  });

  it('the page names its resources "security groups" to the frame', async () => {
    open();
    await opened();
    expect(await screen.findByText('These security groups are in your local emulator')).toBeInTheDocument();
  });
});
