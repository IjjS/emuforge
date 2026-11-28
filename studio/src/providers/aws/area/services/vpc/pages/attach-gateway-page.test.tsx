import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import * as network from '../../../lib/ec2-network-choices';
import * as api from '../api';
import * as changes from '../gateway-changes-api';

// S14 rendered inside the area's layout, with the calls of `lib/ec2-network-choices.ts` (the VPC field), `api.ts` (the
// gateway of the address, and the list the form leads to) and `gateway-changes-api.ts` answered by the case (their own
// tests prove the calls against a fake engine).

vi.mock('../../../lib/ec2-network-choices', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../lib/ec2-network-choices')>();
  return { ...real, listVpcChoices: vi.fn() };
});

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, getInternetGateway: vi.fn(), listInternetGateways: vi.fn(), getVpc: vi.fn() };
});

vi.mock('../gateway-changes-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../gateway-changes-api')>();
  return { ...real, attachInternetGateway: vi.fn() };
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

const EMULATOR = { port: 9574, endpoint: 'https://127.0.0.1:9574' };
const connectedResult = (): CheckResult => ({ kind: 'connected', checkedAt: Date.now(), emulator: EMULATOR });
const notStartedResult = (): CheckResult => ({
  kind: 'emulator-unreachable',
  checkedAt: Date.now(),
  emulator: EMULATOR,
  reason: 'not_started',
  message: '',
});

let connection: Connection;
const ENGINE = 'http://127.0.0.1:8574';

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

function open(path = ATTACH_PATH) {
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

const ATTACH_PATH = '/aws/vpc/internet-gateways/gateway/igw-1/attach';
const LIST_PATH = '/aws/vpc/internet-gateways';

const VPCS: network.VpcChoice[] = [
  { id: 'vpc-d', cidr: '172.31.0.0/16', isDefault: true },
  { id: 'vpc-x', name: 'app', cidr: '10.0.0.0/16', isDefault: false },
];

function gateway(id: string, name?: string, vpcId?: string): api.InternetGateway {
  return {
    id,
    tags: name === undefined ? [] : [{ key: 'Name', value: name }],
    ...(vpcId === undefined ? {} : { vpcId }),
  };
}

const DETACHED: api.Read<api.InternetGateway> = { found: true, value: gateway('igw-1', 'edge') };

beforeEach(() => {
  vi.mocked(network.listVpcChoices).mockResolvedValue({ choices: VPCS });
  vi.mocked(api.getInternetGateway).mockResolvedValue(DETACHED);
  vi.mocked(api.listInternetGateways).mockResolvedValue({ items: [gateway('igw-1', 'edge')] });
  vi.mocked(changes.attachInternetGateway).mockResolvedValue(undefined);
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

function vpcSelect() {
  const found = createWrapper(field('VPC').getElement()).findSelect();
  if (found === null) {
    throw new Error('no VPC select');
  }
  return found;
}

const errorOf = (label: string) => text(field(label).findError()?.getElement());

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
}

function heading() {
  return screen.getByRole('heading', { level: 1, name: /Attach internet gateway/ });
}

async function formShown() {
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Attach' })).toBeInTheDocument();
  });
}

function alertText(): string {
  const form = document.querySelector('form');
  return form === null ? '' : text(createWrapper(form).findAlert()?.getElement());
}

async function chooseVpc(id: string) {
  const select = vpcSelect();
  if (select.findTrigger().getElement().getAttribute('aria-expanded') !== 'true') {
    select.openDropdown();
  }
  await chooseOpenVpc(id);
}

function expectVpcDisabled(id: string) {
  const option = vpcSelect().findDropdown().findOptionByValue(id);
  expect(option?.getElement().closest('[role="option"]')).toHaveAttribute('aria-disabled', 'true');
}

async function chooseOpenVpc(id: string) {
  const select = vpcSelect();
  const dropdown = select.findDropdown();
  await waitFor(() => expect(dropdown.findOptionByValue(id)?.isDisabled()).toBe(false));
  select.selectOptionByValue(id);
}

function attachButton() {
  return screen.getByRole('button', { name: 'Attach' });
}

function rows(): string[] {
  return (PAGE.findTable()?.findRows() ?? []).map((row) => text(row.getElement()));
}

describe('Attach internet gateway', () => {
  it('a detached gateway → the form names it in its description and shows "VPC" with no VPC chosen', async () => {
    open();
    await formShown();
    expect(vi.mocked(api.getInternetGateway).mock.calls[0]?.slice(0, 2)).toEqual([ENGINE, 'igw-1']);
    expect(heading()).toBeInTheDocument();
    expect(screen.getByText('Attaches edge to a VPC.')).toBeInTheDocument();
    expect(text(vpcSelect().findTrigger().getElement())).toBe('Choose a VPC');
  });

  it('the form\'s container has no heading that repeats the field\'s label "VPC"', async () => {
    open();
    await formShown();
    const form = document.querySelector('form') as HTMLElement;
    expect(within(form).queryByRole('heading', { name: 'VPC' })).toBeNull();
    expect(within(form).queryAllByRole('heading')).toEqual([]);
    expect(field('VPC')).toBeDefined();
  });

  it('opened with ?vpc= of a VPC the emulator holds → that VPC chosen once its read answers, the field locked until then; "Attach" sends it', async () => {
    let answer: (read: api.Read<api.Vpc>) => void = () => undefined;
    vi.mocked(api.getVpc).mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const router = open(`${ATTACH_PATH}?vpc=vpc-x`);
    await formShown();
    await waitFor(() => {
      expect(api.getVpc).toHaveBeenCalled();
    });
    expect(vi.mocked(api.getVpc).mock.calls[0]?.slice(0, 2)).toEqual([ENGINE, 'vpc-x']);
    expect(vpcSelect().isDisabled()).toBe(true);
    act(() => {
      answer({
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
    });
    await waitFor(() => {
      expect(vpcSelect().isDisabled()).toBe(false);
    });
    expect(text(vpcSelect().findTrigger().getElement())).toContain('vpc-x');
    submit();
    await waitFor(() => {
      expect(screen.getByText('Attached igw-1 to vpc-x')).toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe(LIST_PATH);
    expect(vi.mocked(changes.attachInternetGateway).mock.calls[0]?.slice(0, 3)).toEqual([ENGINE, 'igw-1', 'vpc-x']);
  });

  it('opened with ?vpc= of a VPC the emulator does not hold → "VPC" unchosen with "The emulator holds no VPC {id}. Choose another."', async () => {
    vi.mocked(api.getVpc).mockResolvedValue({ found: false });
    open(`${ATTACH_PATH}?vpc=vpc-gone`);
    await formShown();
    await waitFor(() => {
      expect(text(field('VPC').getElement())).toContain('The emulator holds no VPC vpc-gone. Choose another.');
    });
    expect(text(vpcSelect().findTrigger().getElement())).toBe('Choose a VPC');
  });

  it('"Attach" with no VPC → "Choose a VPC." and nothing sent', async () => {
    open();
    await formShown();
    await waitFor(() => expect(attachButton()).toBeEnabled());
    submit();
    expect(errorOf('VPC')).toBe('Choose a VPC.');
    expect(changes.attachInternetGateway).not.toHaveBeenCalled();
  });

  it('a VPC chosen → one attach with the gateway\'s and the VPC\'s ID; the gateways list with "Attached {id} to {vpc id}"', async () => {
    const router = open();
    await formShown();
    await chooseVpc('vpc-x');
    submit();
    await waitFor(() => {
      expect(screen.getByText('Attached igw-1 to vpc-x')).toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe(LIST_PATH);
    expect(changes.attachInternetGateway).toHaveBeenCalledTimes(1);
    expect(vi.mocked(changes.attachInternetGateway).mock.calls[0]?.slice(0, 3)).toEqual([ENGINE, 'igw-1', 'vpc-x']);
  });

  it('a refusal → the form stays with the code and message and the choice', async () => {
    const message = 'Network vpc-x already has an internet gateway attached';
    vi.mocked(changes.attachInternetGateway).mockRejectedValue(
      new RequestError({ kind: 'other', operation: 'AttachInternetGateway', code: 'InvalidParameterValue', message }),
    );
    const router = open();
    await formShown();
    await chooseVpc('vpc-x');
    submit();
    await waitFor(() => {
      expect(alertText()).toContain('InvalidParameterValue');
    });
    expect(alertText()).toContain(message);
    expect(router.state.location.pathname).toBe(ATTACH_PATH);
    expect(text(vpcSelect().findTrigger().getElement())).toContain('vpc-x');
  });

  it('a 501 → "not implemented by the emulator" with AttachInternetGateway', async () => {
    vi.mocked(changes.attachInternetGateway).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'AttachInternetGateway' }),
    );
    open();
    await formShown();
    await chooseVpc('vpc-x');
    submit();
    await waitFor(() => {
      expect(alertText()).toContain('Not implemented by the emulator');
    });
    expect(alertText()).toContain('AttachInternetGateway');
  });

  it('while attaching, the button reads "Attaching" and a second press sends nothing', async () => {
    let finish: () => void = () => undefined;
    vi.mocked(changes.attachInternetGateway).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => {
            resolve(undefined);
          };
        }),
    );
    open();
    await formShown();
    await chooseVpc('vpc-x');
    submit();
    const attaching = await screen.findByRole('button', { name: 'Attaching' });
    fireEvent.click(attaching);
    fireEvent.submit(attaching.closest('form') as HTMLFormElement);
    expect(changes.attachInternetGateway).toHaveBeenCalledTimes(1);
    act(() => {
      finish();
    });
    await waitFor(() => {
      expect(screen.getByText('Attached igw-1 to vpc-x')).toBeInTheDocument();
    });
  });

  it('an attached gateway → "{id} is attached to {vpc id}." with "View internet gateways", and no form to send', async () => {
    vi.mocked(api.getInternetGateway).mockResolvedValue({ found: true, value: gateway('igw-1', 'edge', 'vpc-x') });
    const router = open();
    expect(await screen.findByText('igw-1 is attached to vpc-x.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Attach' })).toBeNull();
    expect(document.querySelector('form')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'View internet gateways' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(LIST_PATH);
    });
  });

  it('a gateway the emulator does not hold → "Internet gateway not found" with "View internet gateways", and no form', async () => {
    vi.mocked(api.getInternetGateway).mockResolvedValue({ found: false });
    open();
    expect(await screen.findByText('Internet gateway not found')).toBeInTheDocument();
    expect(screen.getByText('The emulator holds no internet gateway with this ID.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View internet gateways' })).toHaveAttribute('href', LIST_PATH);
    expect(document.querySelector('form')).toBeNull();
  });

  it('loading → "Loading internet gateway"', async () => {
    vi.mocked(api.getInternetGateway).mockImplementation(() => new Promise(() => undefined));
    open();
    expect(await screen.findByText('Loading internet gateway')).toBeInTheDocument();
    expect(document.querySelector('form')).toBeNull();
  });

  const failures: [string, RequestFailure, RegExp, boolean?][] = [
    [
      'not implemented',
      { kind: 'not-implemented', operation: 'DescribeInternetGateways' },
      /Not implemented by the emulator.*DescribeInternetGateways/,
    ],
    ['access denied', { kind: 'access-denied', operation: 'DescribeInternetGateways', message: 'no' }, /Access denied/],
    [
      'the emulator not answering',
      { kind: 'emulator-did-not-answer', operation: 'DescribeInternetGateways', message: 'timed out' },
      /The emulator did not answer/,
    ],
    [
      'the engine not answering',
      { kind: 'engine-did-not-answer', operation: 'DescribeInternetGateways' },
      /engine.*did not answer/,
    ],
    [
      'another code and message',
      { kind: 'other', operation: 'DescribeInternetGateways', code: 'InternalError', message: 'broke' },
      /InternalError.*broke/,
    ],
    ['not connected', { kind: 'other', operation: 'DescribeInternetGateways', code: 'X' }, /Not started on port/, true],
  ];
  for (const [kind, failure, shown, down] of failures) {
    it(`a failed read of the gateway, ${kind} → its state with "Retry", which reads again`, async () => {
      if (down === true) {
        connection.value = { result: notStartedResult(), engineOrigin: ENGINE };
      }
      vi.mocked(api.getInternetGateway).mockRejectedValue(new RequestError(failure));
      open();
      const main = () => document.querySelector('main') ?? document.body;
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
      });
      expect(text(screen.getByRole('button', { name: 'Retry' }).closest('div[class]')?.parentElement)).toMatch(shown);
      expect(text(main())).toMatch(shown);
      const calls = vi.mocked(api.getInternetGateway).mock.calls.length;
      vi.mocked(api.getInternetGateway).mockResolvedValue(DETACHED);
      fireEvent.click(within(main() as HTMLElement).getByRole('button', { name: 'Retry' }));
      await formShown();
      expect(vi.mocked(api.getInternetGateway).mock.calls.length).toBe(calls + 1);
    });
  }

  it('"Cancel" with nothing chosen → the gateways list at once', async () => {
    const router = open();
    await formShown();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(LIST_PATH);
    });
    expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument();
  });

  it('"Cancel" after a choice → the discard dialog; "Keep editing" keeps the form, "Discard" leaves', async () => {
    const router = open();
    await formShown();
    await chooseVpc('vpc-x');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Discard what you entered?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe(ATTACH_PATH);
    expect(text(vpcSelect().findTrigger().getElement())).toContain('vpc-x');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(LIST_PATH);
    });
    expect(changes.attachInternetGateway).not.toHaveBeenCalled();
  });

  const APP_READ: api.Read<api.Vpc> = {
    found: true,
    value: {
      id: 'vpc-x',
      state: 'available',
      cidr: '10.0.0.0/16',
      cidrs: ['10.0.0.0/16'],
      isDefault: false,
      tags: [{ key: 'Name', value: 'app' }],
    },
  };
  const addressOf = (router: ReturnType<typeof open>) =>
    `${router.state.location.pathname}${router.state.location.search}`;

  it('opened with ?vpc= → "View internet gateways", "Cancel" and the discard dialog\'s leave each open the gateways list with that ?vpc=; without it, none', async () => {
    vi.mocked(api.getVpc).mockResolvedValue(APP_READ);
    vi.mocked(api.getInternetGateway).mockResolvedValue({ found: true, value: gateway('igw-1', 'edge', 'vpc-x') });
    const viewed = open(`${ATTACH_PATH}?vpc=vpc-x`);
    fireEvent.click(await screen.findByRole('link', { name: 'View internet gateways' }));
    await waitFor(() => {
      expect(addressOf(viewed)).toBe(`${LIST_PATH}?vpc=vpc-x`);
    });
    cleanup();

    vi.mocked(api.getInternetGateway).mockResolvedValue(DETACHED);
    const cancelled = open(`${ATTACH_PATH}?vpc=vpc-x`);
    await formShown();
    await waitFor(() => {
      expect(text(vpcSelect().findTrigger().getElement())).toContain('vpc-x');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(addressOf(cancelled)).toBe(`${LIST_PATH}?vpc=vpc-x`);
    });
    cleanup();

    const discarded = open(`${ATTACH_PATH}?vpc=vpc-x`);
    await formShown();
    await waitFor(() => {
      expect(vpcSelect().isDisabled()).toBe(false);
    });
    await chooseVpc('vpc-d');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(addressOf(discarded)).toBe(`${LIST_PATH}?vpc=vpc-x`);
    });
    cleanup();

    const plain = open();
    await formShown();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(addressOf(plain)).toBe(LIST_PATH);
    });
  });

  it('opened with ?vpc=, "Attach" answered 200 → the gateways list with that ?vpc= and "Attached {id} to {vpc id}"; without it, none', async () => {
    vi.mocked(api.getVpc).mockResolvedValue(APP_READ);
    const scoped = open(`${ATTACH_PATH}?vpc=vpc-x`);
    await formShown();
    await waitFor(() => {
      expect(text(vpcSelect().findTrigger().getElement())).toContain('vpc-x');
    });
    submit();
    await waitFor(() => {
      expect(screen.getByText('Attached igw-1 to vpc-x')).toBeInTheDocument();
    });
    expect(addressOf(scoped)).toBe(`${LIST_PATH}?vpc=vpc-x`);
    cleanup();

    const plain = open();
    await formShown();
    await chooseVpc('vpc-x');
    submit();
    await waitFor(() => {
      expect(screen.getByText('Attached igw-1 to vpc-x')).toBeInTheDocument();
    });
    expect(addressOf(plain)).toBe(LIST_PATH);
  });

  async function openChoices() {
    const select = vpcSelect();
    select.openDropdown();
    await waitFor(() => {
      expect(select.findDropdown().findOptionByValue('vpc-x')).not.toBeNull();
    });
  }

  const CHECKING = 'Checking which VPCs have an internet gateway';
  const attachment = gateway('igw-other', 'external', 'vpc-x');
  const occupied = 'vpc-x already has igw-other. Choose another VPC.';

  function holdAttachments() {
    let answer: (page: api.Page<api.InternetGateway>) => void = () => undefined;
    vi.mocked(api.listInternetGateways).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    return (items: api.InternetGateway[]) => act(() => answer({ items }));
  }

  it('holds every VPC and disables Attach while checking', async () => {
    vi.mocked(api.listInternetGateways).mockImplementation(() => new Promise(() => undefined));
    open();
    await formShown();
    expect(screen.getByText(CHECKING)).toBeInTheDocument();
    expect(attachButton()).toBeDisabled();
    await openChoices();
    for (const id of ['vpc-x', 'vpc-d']) {
      expectVpcDisabled(id);
      vpcSelect().selectOptionByValue(id);
    }
    expect(text(vpcSelect().findTrigger().getElement())).toBe('Choose a VPC');
    expect(changes.attachInternetGateway).not.toHaveBeenCalled();
  });

  it('marks an occupied VPC as disabled and enables Attach with a free VPC selected', async () => {
    vi.mocked(api.listInternetGateways).mockResolvedValue({ items: [attachment] });
    open();
    await formShown();
    await openChoices();
    const dropdown = vpcSelect().findDropdown();
    await waitFor(() => {
      expect(dropdown.findOptionByValue('vpc-x')?.getElement()).toHaveTextContent('Has igw-other');
    });
    expectVpcDisabled('vpc-x');
    expect(dropdown.findOptionByValue('vpc-d')?.getElement()).not.toHaveTextContent('Has ');
    vpcSelect().selectOptionByValue('vpc-x');
    expect(text(vpcSelect().findTrigger().getElement())).toBe('Choose a VPC');
    await chooseOpenVpc('vpc-d');
    expect(attachButton()).toBeEnabled();
  });

  it('uses attachments on further pages of the gateway read', async () => {
    vi.mocked(api.listInternetGateways).mockImplementation((_endpoint, _filters, token) =>
      Promise.resolve(
        token === undefined ? { items: [gateway('igw-2', 'spare')], nextToken: 'tok-g' } : { items: [attachment] },
      ),
    );
    open();
    await formShown();
    await waitFor(() => expect(attachButton()).toBeEnabled());
    await openChoices();
    const dropdown = vpcSelect().findDropdown();
    await waitFor(() => {
      expect(dropdown.findOptionByValue('vpc-x')?.getElement()).toHaveTextContent('Has igw-other');
    });
    expect(vi.mocked(api.listInternetGateways).mock.calls.map((call) => call[2])).toEqual([
      undefined,
      'tok-g',
      undefined,
      'tok-g',
    ]);
  });

  it('shows a gateway lookup failure and holds the VPC field until Retry succeeds', async () => {
    vi.mocked(api.listInternetGateways).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'DescribeInternetGateways',
        code: 'InternalError',
        message: 'broke',
      }),
    );
    open();
    await formShown();
    await openChoices();
    await waitFor(() => expect(text(field('VPC').getElement())).toContain('InternalError'));
    expect(attachButton()).toBeDisabled();
    for (const id of ['vpc-x', 'vpc-d']) {
      expectVpcDisabled(id);
    }
    vi.mocked(api.listInternetGateways).mockResolvedValue({ items: [attachment] });
    fireEvent.click(within(field('VPC').getElement()).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(attachButton()).toBeEnabled());
    expect(within(field('VPC').getElement()).queryByText(/InternalError/)).not.toBeInTheDocument();
    await chooseVpc('vpc-d');
  });

  it('shows a gateway lookup 501 with its operation, and prevents choosing and attaching', async () => {
    vi.mocked(api.listInternetGateways).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'DescribeInternetGateways' }),
    );
    open();
    await formShown();
    await openChoices();
    await waitFor(() => {
      expect(text(field('VPC').getElement())).toMatch(/Not implemented by the emulator.*DescribeInternetGateways/);
    });
    expect(text(field('VPC').getElement())).not.toContain('Retry');
    expectVpcDisabled('vpc-x');
    expectVpcDisabled('vpc-d');
    expect(attachButton()).toBeDisabled();
  });

  describe.each(['VPC first', 'gateways first'])('preset reads, %s', (order) => {
    it.each([false, true])('settles the preset once both reads answer (occupied: %s)', async (isOccupied) => {
      const answerGateways = holdAttachments();
      let finishVpc: (read: api.Read<api.Vpc>) => void = () => undefined;
      vi.mocked(api.getVpc).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishVpc = resolve;
          }),
      );
      open(`${ATTACH_PATH}?vpc=vpc-x`);
      await formShown();
      await waitFor(() => expect(api.getVpc).toHaveBeenCalled());
      await waitFor(() => expect(api.listInternetGateways).toHaveBeenCalled());
      const answerVpc = () => act(() => finishVpc(APP_READ));
      const answerOccupancy = () => answerGateways(isOccupied ? [attachment] : []);
      if (order === 'VPC first') {
        answerVpc();
        await waitFor(() => expect(vpcSelect().isDisabled()).toBe(false));
      } else {
        answerOccupancy();
        await waitFor(() => expect(screen.queryByText(CHECKING)).not.toBeInTheDocument());
      }
      expect(text(vpcSelect().findTrigger().getElement())).toBe('Choose a VPC');
      if (order === 'VPC first') answerOccupancy();
      else answerVpc();
      if (isOccupied) {
        expect(await screen.findByText(occupied)).toBeInTheDocument();
        expect(errorOf('VPC')).toBe(occupied);
        expect(text(vpcSelect().findTrigger().getElement())).toBe('Choose a VPC');
      } else {
        await waitFor(() => expect(attachButton()).toBeEnabled());
        expect(text(vpcSelect().findTrigger().getElement())).toContain('vpc-x');
      }
    });
  });

  it.each([false, true])('rechecks a chosen VPC on opening (newly occupied: %s)', async (isOccupied) => {
    open();
    await formShown();
    await chooseVpc('vpc-x');
    const previousReads = vi.mocked(api.listInternetGateways).mock.calls.length;
    const answer = holdAttachments();
    await openChoices();
    await waitFor(() => expect(api.listInternetGateways).toHaveBeenCalledTimes(previousReads + 1));
    expect(screen.getByText(CHECKING)).toBeInTheDocument();
    expect(attachButton()).toBeDisabled();
    expect(text(vpcSelect().findTrigger().getElement())).toContain('vpc-x');
    answer(isOccupied ? [attachment] : []);
    if (isOccupied) {
      expect(await screen.findByText(occupied)).toBeInTheDocument();
      expect(errorOf('VPC')).toBe(occupied);
      expectVpcDisabled('vpc-x');
      expect(text(vpcSelect().findTrigger().getElement())).toBe('Choose a VPC');
    } else {
      await waitFor(() => expect(attachButton()).toBeEnabled());
      expect(text(vpcSelect().findTrigger().getElement())).toContain('vpc-x');
    }
  });

  it('the page names its resources "internet gateways" to the frame', async () => {
    open();
    await formShown();
    expect(await screen.findByText('These internet gateways are in your local emulator')).toBeInTheDocument();
  });

  it('after the attach, the gateway\'s own read, asked again by it and answering "attached" → the gateways list with the result, never the "is attached" state', async () => {
    vi.mocked(api.getInternetGateway)
      .mockResolvedValueOnce(DETACHED)
      .mockResolvedValue({ found: true, value: gateway('igw-1', 'edge', 'vpc-x') });
    let seen = false;
    const observer = new MutationObserver(() => {
      if ((document.body.textContent ?? '').includes('igw-1 is attached to vpc-x.')) {
        seen = true;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const router = open();
    await formShown();
    await chooseVpc('vpc-x');
    submit();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(LIST_PATH);
    });
    expect(await screen.findByText('Attached igw-1 to vpc-x')).toBeInTheDocument();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    observer.disconnect();
    expect(seen).toBe(false);
  });

  for (const order of ['the newest first', 'the oldest first'] as const) {
    it(`after the attach, a list read asked before it and the one asked for it answering ${order} → the list with "Attached {id} to {vpc id}", settled on the newest`, async () => {
      const reads: ((page: api.Page<api.InternetGateway>) => void)[] = [];
      vi.mocked(api.listInternetGateways).mockImplementation(
        () =>
          new Promise((resolve) => {
            reads.push(resolve);
          }),
      );
      const router = open(LIST_PATH);
      await waitFor(() => {
        expect(reads).toHaveLength(1);
      });
      await act(async () => {
        await router.navigate(ATTACH_PATH);
      });
      await formShown();
      // S14's own read of which VPCs hold a gateway is the second call; it answers none.
      await waitFor(() => {
        expect(reads).toHaveLength(2);
      });
      act(() => {
        reads[1]?.({ items: [] });
      });
      vpcSelect().openDropdown();
      await waitFor(() => {
        expect(reads).toHaveLength(3);
      });
      act(() => {
        reads[2]?.({ items: [] });
      });
      await chooseOpenVpc('vpc-x');
      submit();
      await waitFor(() => {
        expect(router.state.location.pathname).toBe(LIST_PATH);
      });
      // The hand-over opens the gateways list and reads it again.
      await waitFor(() => {
        expect(reads).toHaveLength(4);
      });
      const older = { items: [gateway('igw-1', 'older')] };
      const newer = { items: [gateway('igw-1', 'newer', 'vpc-x')] };
      act(() => {
        if (order === 'the newest first') {
          reads[3]?.(newer);
          reads[0]?.(older);
        } else {
          reads[0]?.(older);
          reads[3]?.(newer);
        }
      });
      await waitFor(() => {
        expect(rows()).toHaveLength(1);
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(rows()[0]).toContain('newer');
      expect(screen.queryByText('older')).toBeNull();
      expect(screen.getByText('Attached igw-1 to vpc-x')).toBeInTheDocument();
      expect(screen.queryByText('igw-1 is attached to vpc-x.')).toBeNull();
    });
  }
});
