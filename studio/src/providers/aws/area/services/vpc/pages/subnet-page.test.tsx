import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import * as api from '../api';
import * as changes from '../subnet-changes-api';

// S6 rendered inside the area's layout, with the calls of `api.ts` and `subnet-changes-api.ts` answered by the case
// (`api.test.ts` and `subnet-changes-api.test.ts` prove the calls against a fake engine).

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, getSubnet: vi.fn(), listRouteTables: vi.fn(), listSubnets: vi.fn() };
});

vi.mock('../subnet-changes-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../subnet-changes-api')>();
  return { ...real, deleteSubnet: vi.fn(), setPublicAddresses: vi.fn() };
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

const EMULATOR = { port: 9578, endpoint: 'https://127.0.0.1:9578' };
const connectedResult = (): CheckResult => ({ kind: 'connected', checkedAt: Date.now(), emulator: EMULATOR });
const notStartedResult = (): CheckResult => ({
  kind: 'emulator-unreachable',
  checkedAt: Date.now(),
  emulator: EMULATOR,
  reason: 'not_started',
  message: '',
});

let connection: Connection;
const ENGINE = 'http://127.0.0.1:8578';

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

function open(path = PATH) {
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

const PATH = '/aws/vpc/subnets/subnet/subnet-a';
const ARN = 'arn:aws:ec2:us-east-1:000000000000:subnet/subnet-a';
const SENTENCE = 'Decides whether an instance launched into this subnet gets a public IPv4 address.';

function subnet(changes: Partial<api.Subnet> = {}): api.Subnet {
  return {
    id: 'subnet-a',
    arn: ARN,
    state: 'available',
    vpcId: 'vpc-a',
    cidr: '10.0.1.0/24',
    zone: 'us-east-1a',
    freeAddresses: 251,
    isDefault: false,
    publicAddresses: false,
    tags: [
      { key: 'Name', value: 'app' },
      { key: 'team', value: 'core' },
    ],
    ...changes,
  };
}

function table(id: string, changes: Partial<api.RouteTable> = {}): api.RouteTable {
  return {
    id,
    vpcId: 'vpc-a',
    main: false,
    routes: [
      { destination: { kind: 'ipv4', value: '10.0.0.0/16' }, target: 'local', state: 'active' },
      { destination: { kind: 'ipv4', value: '0.0.0.0/0' }, target: 'igw-1', state: 'blackhole' },
    ],
    associations: [],
    subnetCount: 1,
    tags: [],
    ...changes,
  };
}

function subnetIs(read: api.Read<api.Subnet>) {
  vi.mocked(api.getSubnet).mockResolvedValue(read);
}

/** The route tables answering: the subnet's own (`association.subnet-id`) and the VPC's main one. */
function tablesAre({ own, main }: { own?: api.RouteTable; main?: api.RouteTable }) {
  vi.mocked(api.listRouteTables).mockImplementation((_at, filters) => {
    if (filters.subnetId !== undefined) {
      return Promise.resolve({ items: own === undefined ? [] : [own] });
    }
    return Promise.resolve({ items: main === undefined ? [] : [main] });
  });
}

beforeEach(() => {
  subnetIs({ found: true, value: subnet() });
  tablesAre({ own: table('rtb-own') });
  vi.mocked(api.listSubnets).mockResolvedValue({ items: [] });
  vi.mocked(changes.setPublicAddresses).mockResolvedValue(undefined);
  vi.mocked(changes.deleteSubnet).mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------------------------------------------
// The page as a user reads it.

const PAGE = createWrapper(document.body);
const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function details(): [string, string][] {
  const pairs = PAGE.findKeyValuePairs();
  return (pairs?.findItems() ?? []).map((item) => [
    text(item.findLabel()?.getElement()),
    text(item.findValue()?.getElement()),
  ]);
}

/** The section whose header is `heading`: the nearest Cloudscape container or table around it. */
function section(heading: string): HTMLElement {
  const found = screen.getByRole('heading', { level: 2, name: heading });
  let at: HTMLElement | null = found;
  while (at !== null && text(at) === text(found)) {
    at = at.parentElement;
  }
  while (at !== null && at.parentElement !== null && !/container|table/i.test(at.className)) {
    at = at.parentElement;
  }
  return at ?? found;
}

function routeTableText(): string {
  return text(section('Route table'));
}

async function loaded() {
  expect(await screen.findByRole('heading', { level: 1, name: 'app' })).toBeInTheDocument();
}

function dialog(): Promise<HTMLElement> {
  return screen.findByRole('dialog');
}

async function confirmDelete() {
  const shown = await dialog();
  fireEvent.change(within(shown).getByRole('textbox'), { target: { value: 'delete' } });
  fireEvent.click(within(shown).getByRole('button', { name: 'Delete' }));
}

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

function flashText(): string {
  return text(PAGE.findFlashbar()?.getElement());
}

/** Lets every answer already given settle. */
async function settled() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const refusal = (operation: string, code: string, message: string) =>
  new RequestError({ kind: 'other', operation, code, message });

describe("a subnet's page", () => {
  it('the heading is its name; "Subnet details" with copy controls for the ID and the ARN, the VPC ID a link, and the public addresses with what they decide', async () => {
    open();
    await loaded();
    expect(details()).toEqual([
      ['Subnet ID', 'subnet-a'],
      ['ARN', ARN],
      ['State', 'available'],
      ['VPC ID', 'vpc-a'],
      ['IPv4 CIDR', '10.0.1.0/24'],
      ['Availability Zone', 'us-east-1a'],
      ['Free IPv4 addresses', '251'],
      ['Default subnet', 'No'],
      ['Public IPv4 address on launch', `Off${SENTENCE}Turn on`],
    ]);
    expect(screen.getByRole('heading', { level: 2, name: 'Subnet details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Subnet ID' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy ARN' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'vpc-a' })).toHaveAttribute('href', '/aws/vpc/vpcs/vpc/vpc-a');
    expect(vi.mocked(api.getSubnet).mock.calls[0]?.[1]).toBe('subnet-a');
  });

  it('without a name the heading is its ID; a default subnet with the addresses on → "Yes", "On" and "Turn off"', async () => {
    subnetIs({ found: true, value: subnet({ tags: [], isDefault: true, publicAddresses: true }) });
    open();
    expect(await screen.findByRole('heading', { level: 1, name: 'subnet-a' })).toBeInTheDocument();
    expect(details()).toContainEqual(['Default subnet', 'Yes']);
    expect(details()).toContainEqual(['Public IPv4 address on launch', `On${SENTENCE}Turn off`]);
  });

  it('off → "Turn on" sends one request with true, unavailable while in flight; answered → read again with the result', async () => {
    let finish: () => void = () => undefined;
    vi.mocked(changes.setPublicAddresses).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => {
            resolve(undefined);
          };
        }),
    );
    open();
    await loaded();
    const calls = vi.mocked(api.getSubnet).mock.calls.length;
    const button = screen.getByRole('button', { name: 'Turn on' });
    fireEvent.click(button);
    await waitFor(() => {
      expect(isDisabled(screen.getByRole('button', { name: 'Turn on' }))).toBe(true);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(changes.setPublicAddresses).toHaveBeenCalledTimes(1);
    expect(vi.mocked(changes.setPublicAddresses).mock.calls[0]?.slice(0, 3)).toEqual([ENGINE, 'subnet-a', true]);
    subnetIs({ found: true, value: subnet({ publicAddresses: true }) });
    act(() => {
      finish();
    });
    await waitFor(() => {
      expect(flashText()).toContain('Public IPv4 addresses on launch turned on for subnet-a');
    });
    expect(await screen.findByRole('button', { name: 'Turn off' })).toBeInTheDocument();
    expect(vi.mocked(api.getSubnet).mock.calls.length).toBeGreaterThan(calls);
  });

  it('on → "Turn off" sends false; answered → "… turned off for {id}"', async () => {
    subnetIs({ found: true, value: subnet({ publicAddresses: true }) });
    open();
    await loaded();
    subnetIs({ found: true, value: subnet({ publicAddresses: false }) });
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    await waitFor(() => {
      expect(flashText()).toContain('Public IPv4 addresses on launch turned off for subnet-a');
    });
    expect(vi.mocked(changes.setPublicAddresses).mock.calls[0]?.slice(1, 3)).toEqual(['subnet-a', false]);
    expect(await screen.findByRole('button', { name: 'Turn on' })).toBeInTheDocument();
  });

  it('a refusal of the change → the failure in the flash with the code and message, the value as it was', async () => {
    vi.mocked(changes.setPublicAddresses).mockRejectedValue(
      refusal('ModifySubnetAttribute', 'InvalidParameterValue', 'Value is not valid.'),
    );
    open();
    await loaded();
    const calls = vi.mocked(api.getSubnet).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    await waitFor(() => {
      expect(flashText()).toContain('InvalidParameterValue');
    });
    expect(flashText()).toContain('Value is not valid.');
    await settled();
    expect(details()).toContainEqual(['Public IPv4 address on launch', `Off${SENTENCE}Turn on`]);
    expect(vi.mocked(api.getSubnet).mock.calls.length).toBe(calls);
  });

  it('a 501 of the change → "not implemented by the emulator" with ModifySubnetAttribute', async () => {
    vi.mocked(changes.setPublicAddresses).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'ModifySubnetAttribute' }),
    );
    open();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    await waitFor(() => {
      expect(flashText()).toMatch(/Not implemented by the emulator/i);
    });
    expect(flashText()).toContain('ModifySubnetAttribute');
  });

  it('"Route table": its own table → its ID (to the table\'s page), "Associated with this subnet" and its routes', async () => {
    open();
    await loaded();
    await waitFor(() => {
      expect(routeTableText()).toContain('Associated with this subnet');
    });
    expect(screen.getByRole('link', { name: 'rtb-own' })).toHaveAttribute(
      'href',
      '/aws/vpc/route-tables/route-table/rtb-own',
    );
    const routes = routeTableText();
    expect(routes).toContain('Destination');
    expect(routes).toContain('10.0.0.0/16');
    expect(routes).toContain('local');
    expect(routes).toContain('igw-1');
    expect(routes).toContain('blackhole');
    expect(vi.mocked(api.listRouteTables).mock.calls[0]?.[1]).toEqual({ subnetId: 'subnet-a' });
  });

  it('"Route table": none of its own → the VPC\'s main table with "The VPC\'s main route table"', async () => {
    tablesAre({ main: table('rtb-main', { main: true }) });
    open();
    await loaded();
    await waitFor(() => {
      expect(routeTableText()).toContain("The VPC's main route table");
    });
    expect(screen.getByRole('link', { name: 'rtb-main' })).toBeInTheDocument();
    expect(vi.mocked(api.listRouteTables).mock.calls.map((call) => call[1])).toEqual([
      { subnetId: 'subnet-a' },
      { vpcId: 'vpc-a', main: true },
    ]);
  });

  it('"Route table": neither → "No route table found for this subnet."', async () => {
    tablesAre({});
    open();
    await loaded();
    expect(await screen.findByText('No route table found for this subnet.')).toBeInTheDocument();
  });

  it('"Route table": its read failed → that section alone, with "Retry"', async () => {
    vi.mocked(api.listRouteTables).mockRejectedValue(refusal('DescribeRouteTables', 'InternalError', 'broke'));
    open();
    await loaded();
    await waitFor(() => {
      expect(routeTableText()).toContain('InternalError');
    });
    expect(details()).toContainEqual(['Subnet ID', 'subnet-a']);
    tablesAre({ own: table('rtb-own') });
    fireEvent.click(within(section('Route table')).getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(routeTableText()).toContain('Associated with this subnet');
    });
  });

  it('"Tags" as the tags table shows them', async () => {
    open();
    await loaded();
    const tags = text(section('Tags'));
    expect(tags).toContain('Key');
    expect(tags).toContain('team');
    expect(tags).toContain('core');
  });

  it('an empty answer → "Subnet not found" / "The emulator holds no subnet with this ID." with "View subnets", and no section or action', async () => {
    subnetIs({ found: false });
    const router = open();
    expect(await screen.findByText('Subnet not found')).toBeInTheDocument();
    expect(screen.getByText('The emulator holds no subnet with this ID.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Subnet details' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Route table' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete subnet' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Turn/ })).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'View subnets' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/subnets');
    });
  });

  it('loading → "Loading subnet"', async () => {
    vi.mocked(api.getSubnet).mockImplementation(() => new Promise(() => undefined));
    open();
    expect(await screen.findByText('Loading subnet')).toBeInTheDocument();
  });

  const failures: [string, RequestFailure, RegExp, boolean?][] = [
    [
      'not implemented',
      { kind: 'not-implemented', operation: 'DescribeSubnets' },
      /Not implemented by the emulator.*DescribeSubnets/,
    ],
    ['access denied', { kind: 'access-denied', operation: 'DescribeSubnets', message: 'no' }, /Access denied/],
    [
      'the emulator not answering',
      { kind: 'emulator-did-not-answer', operation: 'DescribeSubnets', message: 'timed out' },
      /The emulator did not answer/,
    ],
    [
      'the engine not answering',
      { kind: 'engine-did-not-answer', operation: 'DescribeSubnets' },
      /engine.*did not answer/,
    ],
    [
      'another code and message',
      { kind: 'other', operation: 'DescribeSubnets', code: 'InternalError', message: 'broke' },
      /InternalError.*broke/,
    ],
    ['not connected', { kind: 'other', operation: 'DescribeSubnets', code: 'X' }, /Not started on port/, true],
  ];
  for (const [kind, failure, shown, down] of failures) {
    it(`a failed read of the subnet, ${kind} → its state with "Retry", which reads again`, async () => {
      if (down === true) {
        connection.value = { result: notStartedResult(), engineOrigin: ENGINE };
      }
      vi.mocked(api.getSubnet).mockRejectedValue(new RequestError(failure));
      open();
      await waitFor(() => {
        expect(text(document.querySelector('main') ?? document.body)).toMatch(shown);
      });
      subnetIs({ found: true, value: subnet() });
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await loaded();
    });
  }

  it('"Refresh" reads the subnet and its route table again', async () => {
    open();
    await loaded();
    await waitFor(() => {
      expect(routeTableText()).toContain('rtb-own');
    });
    const subnets = vi.mocked(api.getSubnet).mock.calls.length;
    const tables = vi.mocked(api.listRouteTables).mock.calls.length;
    subnetIs({ found: true, value: subnet({ state: 'pending' }) });
    tablesAre({ own: table('rtb-new') });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => {
      expect(details()).toContainEqual(['State', 'pending']);
    });
    await waitFor(() => {
      expect(routeTableText()).toContain('rtb-new');
    });
    expect(vi.mocked(api.getSubnet).mock.calls.length).toBe(subnets + 1);
    expect(vi.mocked(api.listRouteTables).mock.calls.length).toBeGreaterThan(tables);
  });

  it('"Delete subnet" confirmed → the subnets list with "Deleted subnet {name or id}"', async () => {
    const router = open();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Delete subnet' }));
    expect(text(await dialog())).toContain('app is deleted from the local emulator.');
    await confirmDelete();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/subnets');
    });
    expect(await screen.findByText('Deleted subnet app')).toBeInTheDocument();
    expect(vi.mocked(changes.deleteSubnet).mock.calls[0]?.slice(0, 2)).toEqual([ENGINE, 'subnet-a']);
  });

  it('a refused delete → the dialog stays with it, and stays when the subnet\'s read then answers "not found"', async () => {
    vi.mocked(changes.deleteSubnet).mockRejectedValue(
      refusal('DeleteSubnet', 'DependencyViolation', "The subnet 'subnet-a' has dependencies and cannot be deleted."),
    );
    const router = open();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Delete subnet' }));
    await confirmDelete();
    const shown = await dialog();
    const alert = await within(shown).findByRole('alert');
    expect(text(alert)).toContain('DependencyViolation');
    subnetIs({ found: false });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Subnet not found')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(text(within(screen.getByRole('dialog')).getByRole('alert'))).toContain('DependencyViolation');
    expect(router.state.location.pathname).toBe(PATH);
  });

  it('after a delete, the subnet\'s "not found" answering before the delete\'s answer is handled → the list with the result, and no state of this page replaces it', async () => {
    let finish: () => void = () => undefined;
    vi.mocked(changes.deleteSubnet).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => {
            resolve(undefined);
          };
        }),
    );
    const router = open();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Delete subnet' }));
    await confirmDelete();
    subnetIs({ found: false });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Subnet not found')).toBeInTheDocument();
    act(() => {
      finish();
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/subnets');
    });
    expect(await screen.findByText('Deleted subnet app')).toBeInTheDocument();
    await settled();
    expect(screen.queryByText('Subnet not found')).toBeNull();
    expect(router.state.location.pathname).toBe('/aws/vpc/subnets');
  });

  it('after the public addresses are changed, a read asked before the change answering last → the value settles on the newest, and the result is still shown', async () => {
    const reads: { resolve: (read: api.Read<api.Subnet>) => void }[] = [];
    vi.mocked(api.getSubnet).mockImplementation(
      () =>
        new Promise((resolve) => {
          reads.push({ resolve });
        }),
    );
    open();
    await waitFor(() => {
      expect(reads).toHaveLength(1);
    });
    act(() => {
      reads[0]?.resolve({ found: true, value: subnet() });
    });
    await loaded();
    // A read asked before the change, still in flight when the change is answered.
    vi.mocked(api.getSubnet).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          reads.push({ resolve });
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    await waitFor(() => {
      expect(flashText()).toContain('turned on for subnet-a');
    });
    await waitFor(() => {
      expect(reads.length).toBeGreaterThanOrEqual(2);
    });
    const newest = reads.length - 1;
    act(() => {
      reads[newest]?.resolve({ found: true, value: subnet({ publicAddresses: true }) });
    });
    expect(await screen.findByRole('button', { name: 'Turn off' })).toBeInTheDocument();
    act(() => {
      for (let index = 1; index < newest; index += 1) {
        reads[index]?.resolve({ found: true, value: subnet({ publicAddresses: false }) });
      }
    });
    await settled();
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeInTheDocument();
    expect(flashText()).toContain('Public IPv4 addresses on launch turned on for subnet-a');
  });

  it('the page names its resources "subnets" to the frame', async () => {
    open();
    expect(await screen.findByText('These subnets are in your local emulator')).toBeInTheDocument();
  });
});
