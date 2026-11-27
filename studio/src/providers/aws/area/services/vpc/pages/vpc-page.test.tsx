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
import * as api from '../api';
import * as changes from '../vpc-changes-api';

// S3 rendered inside the area's layout, with the calls of `api.ts` and `vpc-changes-api.ts` answered by the case
// (`api.test.ts` and `vpc-changes-api.test.ts` prove the calls against a fake engine).

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return {
    ...real,
    listVpcs: vi.fn(),
    getVpc: vi.fn(),
    getDnsSetting: vi.fn(),
    listSubnets: vi.fn(),
    listRouteTables: vi.fn(),
    listInternetGateways: vi.fn(),
  };
});

vi.mock('../vpc-changes-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../vpc-changes-api')>();
  return { ...real, deleteVpc: vi.fn() };
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

function open(path = PAGE_PATH) {
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

const PAGE_PATH = '/aws/vpc/vpcs/vpc/vpc-a';

function vpc(id: string, name: string | undefined, changes: Partial<api.Vpc> = {}): api.Vpc {
  return {
    id,
    state: 'available',
    cidr: '10.0.0.0/16',
    cidrs: ['10.0.0.0/16'],
    isDefault: false,
    tags: name === undefined ? [] : [{ key: 'Name', value: name }],
    ...changes,
  };
}

function subnet(id: string, name: string | undefined): api.Subnet {
  return {
    id,
    state: 'available',
    vpcId: 'vpc-a',
    cidr: '10.0.1.0/24',
    zone: 'us-east-1a',
    freeAddresses: 251,
    isDefault: false,
    publicAddresses: false,
    tags: name === undefined ? [] : [{ key: 'Name', value: name }],
  };
}

function routeTable(id: string, name: string | undefined, main: boolean, subnetCount: number): api.RouteTable {
  return {
    id,
    vpcId: 'vpc-a',
    main,
    routes: [],
    associations: [],
    subnetCount,
    tags: name === undefined ? [] : [{ key: 'Name', value: name }],
  };
}

const APP = vpc('vpc-a', 'app', {
  cidrs: ['10.0.0.0/16', '10.1.0.0/16'],
  tags: [
    { key: 'Name', value: 'app' },
    { key: 'team', value: 'payments' },
  ],
});

/** Every read answering at once: the VPC, its DNS settings (support on, hostnames off) and empty sections. */
function answerAll(found: api.Read<api.Vpc> = { found: true, value: APP }) {
  vi.mocked(api.getVpc).mockResolvedValue(found);
  vi.mocked(api.getDnsSetting).mockImplementation((_endpoint, _id, setting) =>
    Promise.resolve(setting === 'enableDnsSupport'),
  );
  vi.mocked(api.listSubnets).mockResolvedValue({ items: [] });
  vi.mocked(api.listRouteTables).mockResolvedValue({ items: [] });
  vi.mocked(api.listInternetGateways).mockResolvedValue({ items: [] });
  vi.mocked(api.listVpcs).mockResolvedValue({ items: [] });
}

beforeEach(() => {
  answerAll();
});

const PAGE = createWrapper(document.body);
const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The table whose header reads `title`. */
function section(title: string) {
  const found = PAGE.findAllTables().find((each) => text(each.findHeaderSlot()?.getElement()).startsWith(title));
  if (found === undefined) {
    throw new Error(`no table ${title}`);
  }
  return found;
}

function rowsOf(title: string): string[][] {
  return (section(title).findRows() ?? []).map((row) =>
    [...row.getElement().querySelectorAll('td, th')].map((cell) => text(cell)),
  );
}

/** The container whose header reads `title`. */
function container(title: string): HTMLElement {
  const found = PAGE.findAllContainers().find((each) => text(each.findHeader()?.getElement()).startsWith(title));
  if (found === undefined) {
    throw new Error(`no container ${title}`);
  }
  return found.getElement();
}

/** The value of `label` in "VPC details". */
function detail(label: string): string {
  const pairs = createWrapper(container('VPC details')).findKeyValuePairs();
  const item = pairs?.findItems().find((each) => text(each.findLabel()?.getElement()) === label);
  if (item === undefined) {
    throw new Error(`no detail ${label}`);
  }
  return text(item.findValue()?.getElement());
}

async function loaded() {
  await screen.findByText('VPC details');
}

function dialog(): Promise<HTMLElement> {
  return screen.findByRole('dialog');
}

async function confirmDelete() {
  const shown = await dialog();
  fireEvent.change(within(shown).getByRole('textbox'), { target: { value: 'delete' } });
  fireEvent.click(within(shown).getByRole('button', { name: 'Delete' }));
}

/** Lets every answer already given settle (order, not time; see the VPC list's test). */
async function settled() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// ---------------------------------------------------------------------------------------------------------------

describe("a VPC's page", () => {
  it('shows the exact Name tag and identifies the heading by its escaped name', async () => {
    answerAll({ found: true, value: vpc('vpc-a', 'p664 a  b') });
    open();
    await loaded();
    const identity = String.raw`p664 a\u0020\u0020b`;
    const heading = await screen.findByRole('heading', { level: 1, name: identity });
    const name = within(heading).getByText('p664 a  b', { normalizer: (value) => value });
    expect(name.parentElement?.textContent).toBe(`p664 a  b (${identity})`);
  });

  it('a VPC with a name → its name as the heading and "VPC details" with every value', async () => {
    open();
    await loaded();
    expect(screen.getByRole('heading', { level: 1, name: 'app' })).toBeInTheDocument();
    await waitFor(() => {
      expect(detail('DNS resolution')).toBe('On');
    });
    expect(detail('VPC ID')).toBe('vpc-a');
    expect(within(container('VPC details')).getByRole('button', { name: 'Copy VPC ID' })).toBeInTheDocument();
    expect(detail('State')).toBe('available');
    expect(detail('IPv4 CIDR blocks')).toBe('10.0.0.0/1610.1.0.0/16');
    for (const block of ['10.0.0.0/16', '10.1.0.0/16']) {
      expect(within(container('VPC details')).getByText(block)).toBeInTheDocument();
    }
    expect(detail('Default VPC')).toBe('No');
    expect(detail('DNS hostnames')).toBe('Off');
    expect(vi.mocked(api.getVpc).mock.calls[0]?.slice(0, 2)).toEqual([ENGINE, 'vpc-a']);
    expect(
      vi
        .mocked(api.getDnsSetting)
        .mock.calls.map((call) => call.slice(1, 3))
        .sort(),
    ).toEqual([
      ['vpc-a', 'enableDnsHostnames'],
      ['vpc-a', 'enableDnsSupport'],
    ]);
  });

  it('without a name → the heading is its ID; the default VPC reads "Yes"', async () => {
    answerAll({ found: true, value: vpc('vpc-a', undefined, { isDefault: true }) });
    open();
    await loaded();
    expect(screen.getByRole('heading', { level: 1, name: 'vpc-a' })).toBeInTheDocument();
    expect(detail('Default VPC')).toBe('Yes');
  });

  it('a DNS setting while it is read → loading in that value alone', async () => {
    vi.mocked(api.getDnsSetting).mockImplementation((_endpoint, _id, setting) =>
      setting === 'enableDnsSupport' ? new Promise(() => undefined) : Promise.resolve(true),
    );
    open();
    await loaded();
    await waitFor(() => {
      expect(detail('DNS hostnames')).toBe('On');
    });
    expect(detail('DNS resolution')).toBe('Loading');
    expect(detail('State')).toBe('available');
  });

  it('a DNS setting whose read failed → the failure in that value alone, the rest shown', async () => {
    vi.mocked(api.getDnsSetting).mockImplementation((_endpoint, _id, setting) =>
      setting === 'enableDnsHostnames'
        ? Promise.reject(
            new RequestError({
              kind: 'other',
              operation: 'DescribeVpcAttribute',
              code: 'InternalError',
              message: 'broke',
            }),
          )
        : Promise.resolve(true),
    );
    open();
    await loaded();
    await waitFor(() => {
      expect(detail('DNS hostnames')).toMatch(/InternalError.*broke/);
    });
    expect(detail('DNS resolution')).toBe('On');
    expect(detail('IPv4 CIDR blocks')).toBe('10.0.0.0/1610.1.0.0/16');
    expect(rowsOf('Subnets')).toHaveLength(0);
  });

  it('"Subnets": a row each, the ID a link to the subnet; none → "No subnets"; the next page asks with the token; "Create subnet" with this VPC', async () => {
    vi.mocked(api.listSubnets).mockImplementation((_endpoint, _filters, token) =>
      Promise.resolve(
        token === undefined
          ? { items: [subnet('subnet-1', 'web'), subnet('subnet-2', undefined)], nextToken: 'tok-s' }
          : { items: [subnet('subnet-3', 'db')] },
      ),
    );
    const router = open();
    await loaded();
    await waitFor(() => {
      expect(rowsOf('Subnets')).toEqual([
        ['web', 'subnet-1', '10.0.1.0/24', 'us-east-1a', '251'],
        ['-', 'subnet-2', '10.0.1.0/24', 'us-east-1a', '251'],
      ]);
    });
    expect((section('Subnets').findColumnHeaders() ?? []).map((each) => text(each.getElement()))).toEqual([
      'Name',
      'Subnet ID',
      'IPv4 CIDR',
      'Availability Zone',
      'Free IPv4 addresses',
    ]);
    expect(vi.mocked(api.listSubnets).mock.calls[0]?.slice(1, 3)).toEqual([{ vpcId: 'vpc-a' }, undefined]);
    expect(screen.getByRole('link', { name: 'subnet-1' })).toHaveAttribute('href', '/aws/vpc/subnets/subnet/subnet-1');
    fireEvent.click(section('Subnets').findPagination()?.findNextPageButton().getElement() as HTMLElement);
    await waitFor(() => {
      expect(rowsOf('Subnets')).toEqual([['db', 'subnet-3', '10.0.1.0/24', 'us-east-1a', '251']]);
    });
    expect(vi.mocked(api.listSubnets).mock.calls.at(-1)?.slice(1, 3)).toEqual([{ vpcId: 'vpc-a' }, 'tok-s']);
    fireEvent.click(
      within(section('Subnets').findHeaderSlot()?.getElement() as HTMLElement).getByRole('link', {
        name: 'Create subnet',
      }),
    );
    await waitFor(() => {
      expect(`${router.state.location.pathname}${router.state.location.search}`).toBe(
        '/aws/vpc/subnets/create?vpc=vpc-a',
      );
    });
  });

  it('"Subnets" with none → "No subnets" / "This VPC has no subnet."', async () => {
    open();
    await loaded();
    const slot = await waitFor(() => {
      const found = section('Subnets').findEmptySlot()?.getElement();
      expect(text(found)).toContain('No subnets');
      return found as HTMLElement;
    });
    expect(text(slot)).toContain('This VPC has no subnet.');
    expect(within(slot).getByRole('link', { name: 'Create subnet' })).toHaveAttribute(
      'href',
      '/aws/vpc/subnets/create?vpc=vpc-a',
    );
  });

  it.each([
    { table: 'Subnets', id: 'subnet-2', href: '/aws/vpc/subnets/subnet/subnet-2' },
    { table: 'Route tables', id: 'rtb-2', href: '/aws/vpc/route-tables/route-table/rtb-2' },
  ])('distinguishes Name tags with repeated spaces in $table and links by ID', async ({ table, id, href }) => {
    vi.mocked(api.listSubnets).mockResolvedValue({
      items: [subnet('subnet-1', 'p664 a b'), subnet('subnet-2', 'p664 a  b')],
    });
    vi.mocked(api.listRouteTables).mockResolvedValue({
      items: [routeTable('rtb-1', 'p664 a b', false, 0), routeTable('rtb-2', 'p664 a  b', false, 0)],
    });
    open();

    await loaded();
    const listing = within(section(table).getElement());
    const link = await listing.findByRole('link', { name: id });
    expect(link).toHaveAttribute('href', href);
    const identity = String.raw`p664 a\u0020\u0020b`;
    expect(listing.getByRole('cell', { name: 'p664 a b' })).toBeInTheDocument();
    const cell = listing.getByRole('cell', { name: identity });
    expect(cell.closest('tr')).toBe(link.closest('tr'));
    const name = within(cell).getByText('p664 a  b', { normalizer: (value) => value });
    expect(name.parentElement?.textContent).toBe(`p664 a  b (${identity})`);
  });

  it('"Route tables": a row each, the ID a link to the table; none → "No route tables"; the next page asks with the token; "Create route table" with this VPC', async () => {
    vi.mocked(api.listRouteTables).mockImplementation((_endpoint, _filters, token) =>
      Promise.resolve(
        token === undefined
          ? {
              items: [routeTable('rtb-main', undefined, true, 0), routeTable('rtb-pub', 'public', false, 2)],
              nextToken: 'tok-r',
            }
          : { items: [] },
      ),
    );
    const router = open();
    await loaded();
    await waitFor(() => {
      expect(rowsOf('Route tables')).toEqual([
        ['-', 'rtb-main', 'Yes', '0'],
        ['public', 'rtb-pub', 'No', '2'],
      ]);
    });
    expect((section('Route tables').findColumnHeaders() ?? []).map((each) => text(each.getElement()))).toEqual([
      'Name',
      'Route table ID',
      'Main',
      'Associated subnets',
    ]);
    expect(vi.mocked(api.listRouteTables).mock.calls[0]?.slice(1, 3)).toEqual([{ vpcId: 'vpc-a' }, undefined]);
    expect(screen.getByRole('link', { name: 'rtb-pub' })).toHaveAttribute(
      'href',
      '/aws/vpc/route-tables/route-table/rtb-pub',
    );
    fireEvent.click(section('Route tables').findPagination()?.findNextPageButton().getElement() as HTMLElement);
    await waitFor(() => {
      expect(vi.mocked(api.listRouteTables).mock.calls.at(-1)?.slice(1, 3)).toEqual([{ vpcId: 'vpc-a' }, 'tok-r']);
    });
    fireEvent.click(
      within(section('Route tables').findHeaderSlot()?.getElement() as HTMLElement).getByRole('link', {
        name: 'Create route table',
      }),
    );
    await waitFor(() => {
      expect(`${router.state.location.pathname}${router.state.location.search}`).toBe(
        '/aws/vpc/route-tables/create?vpc=vpc-a',
      );
    });
  });

  it('"Route tables" with none → "No route tables"', async () => {
    open();
    await loaded();
    await waitFor(() => {
      expect(text(section('Route tables').findEmptySlot()?.getElement())).toContain('No route tables');
    });
  });

  it('"Subnets" and "Route tables" each show a counter of the rows read; with a further page "(50+)"; none while read or failed', async () => {
    const counterOf = (title: string) =>
      section(title).findHeaderSlot()?.findHeader()?.findCounter()?.getElement().textContent?.trim();
    let answerSubnets: (page: api.Page<api.Subnet>) => void = () => undefined;
    vi.mocked(api.listSubnets).mockImplementation(
      () =>
        new Promise((resolve) => {
          answerSubnets = resolve;
        }),
    );
    vi.mocked(api.listRouteTables).mockRejectedValue(failed('DescribeRouteTables'));
    open();
    await loaded();
    await waitFor(() => {
      expect(text(section('Route tables').findEmptySlot()?.getElement())).toContain('DescribeRouteTables broke');
    });
    expect(text(section('Subnets').getElement())).toContain('Loading subnets');
    expect(counterOf('Subnets')).toBeUndefined();
    expect(counterOf('Route tables')).toBeUndefined();
    act(() => {
      answerSubnets({ items: [subnet('subnet-1', 'web'), subnet('subnet-2', undefined)] });
    });
    await waitFor(() => {
      expect(counterOf('Subnets')).toBe('(2)');
    });
    vi.mocked(api.listRouteTables).mockResolvedValue({
      items: Array.from({ length: 50 }, (_, index) => routeTable(`rtb-${String(index)}`, undefined, index === 0, 0)),
      nextToken: 'tok-r',
    });
    fireEvent.click(
      within(section('Route tables').findEmptySlot()?.getElement() as HTMLElement).getByRole('button', {
        name: 'Retry',
      }),
    );
    await waitFor(() => {
      expect(counterOf('Route tables')).toBe('(50+)');
    });
  });

  it('"Internet gateway": the attached gateway\'s ID and name with "View internet gateways"; none → the sentence', async () => {
    vi.mocked(api.listInternetGateways).mockResolvedValue({
      items: [{ id: 'igw-1', vpcId: 'vpc-a', tags: [{ key: 'Name', value: 'edge' }] }],
    });
    const router = open();
    await loaded();
    await waitFor(() => {
      expect(text(container('Internet gateway'))).toContain('igw-1');
    });
    expect(text(container('Internet gateway'))).toContain('Internet gateway ID');
    expect(text(container('Internet gateway'))).toContain('edge');
    expect(vi.mocked(api.listInternetGateways).mock.calls[0]?.slice(1, 3)).toEqual([{ vpcId: 'vpc-a' }, undefined]);
    fireEvent.click(within(container('Internet gateway')).getByRole('link', { name: 'View internet gateways' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/internet-gateways');
    });
  });

  it('"Internet gateway" with none attached → "No internet gateway is attached to this VPC."', async () => {
    open();
    await loaded();
    await waitFor(() => {
      expect(text(container('Internet gateway'))).toContain('No internet gateway is attached to this VPC.');
    });
  });

  it('"Internet gateway" with none attached → "Attach internet gateway" is its header\'s action, the one link of that name, to the gateways with ?vpc= this VPC; one attached → the header holds "View internet gateways"', async () => {
    const headerOf = () =>
      PAGE.findAllContainers()
        .find((each) => text(each.findHeader()?.getElement()).startsWith('Internet gateway'))
        ?.findHeader()
        ?.getElement() as HTMLElement;
    const router = open();
    await loaded();
    await waitFor(() => {
      expect(text(container('Internet gateway'))).toContain('No internet gateway is attached to this VPC.');
    });
    expect(screen.getAllByRole('link', { name: 'Attach internet gateway' })).toHaveLength(1);
    const link = within(headerOf()).getByRole('link', { name: 'Attach internet gateway' });
    expect(link).toHaveAttribute('href', '/aws/vpc/internet-gateways?vpc=vpc-a');
    expect(within(headerOf()).queryByRole('link', { name: 'View internet gateways' })).toBeNull();
    fireEvent.click(link);
    await waitFor(() => {
      expect(`${router.state.location.pathname}${router.state.location.search}`).toBe(
        '/aws/vpc/internet-gateways?vpc=vpc-a',
      );
    });
    cleanup();

    vi.mocked(api.listInternetGateways).mockResolvedValue({
      items: [{ id: 'igw-1', vpcId: 'vpc-a', tags: [{ key: 'Name', value: 'edge' }] }],
    });
    open();
    await loaded();
    await waitFor(() => {
      expect(text(container('Internet gateway'))).toContain('igw-1');
    });
    expect(within(headerOf()).getByRole('link', { name: 'View internet gateways' })).toHaveAttribute(
      'href',
      '/aws/vpc/internet-gateways',
    );
    expect(screen.queryByRole('link', { name: 'Attach internet gateway' })).toBeNull();
  });

  it('"Tags" as the tags table shows them', async () => {
    open();
    await loaded();
    expect(rowsOf('Tags')).toEqual([
      ['Name', 'app'],
      ['team', 'payments'],
    ]);
  });

  const failed = (operation: string) =>
    new RequestError({ kind: 'other', operation, code: 'InternalError', message: `${operation} broke` });

  it('a failed read of the subnets, the route tables or the gateway fails that section alone, with "Retry"', async () => {
    vi.mocked(api.listSubnets).mockRejectedValue(failed('DescribeSubnets'));
    vi.mocked(api.listRouteTables).mockRejectedValue(failed('DescribeRouteTables'));
    vi.mocked(api.listInternetGateways).mockRejectedValue(failed('DescribeInternetGateways'));
    open();
    await loaded();
    await waitFor(() => {
      expect(text(section('Subnets').findEmptySlot()?.getElement())).toContain('DescribeSubnets broke');
      expect(text(section('Route tables').findEmptySlot()?.getElement())).toContain('DescribeRouteTables broke');
      expect(text(container('Internet gateway'))).toContain('DescribeInternetGateways broke');
    });
    expect(detail('State')).toBe('available');
    expect(rowsOf('Tags')).toHaveLength(2);

    vi.mocked(api.listSubnets).mockResolvedValue({ items: [subnet('subnet-1', 'web')] });
    fireEvent.click(
      within(section('Subnets').findEmptySlot()?.getElement() as HTMLElement).getByRole('button', { name: 'Retry' }),
    );
    await waitFor(() => {
      expect(rowsOf('Subnets')).toHaveLength(1);
    });
    expect(text(section('Route tables').findEmptySlot()?.getElement())).toContain('DescribeRouteTables broke');

    vi.mocked(api.listRouteTables).mockResolvedValue({ items: [routeTable('rtb-main', undefined, true, 0)] });
    fireEvent.click(
      within(section('Route tables').findEmptySlot()?.getElement() as HTMLElement).getByRole('button', {
        name: 'Retry',
      }),
    );
    await waitFor(() => {
      expect(rowsOf('Route tables')).toHaveLength(1);
    });

    vi.mocked(api.listInternetGateways).mockResolvedValue({ items: [] });
    fireEvent.click(within(container('Internet gateway')).getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(text(container('Internet gateway'))).toContain('No internet gateway is attached to this VPC.');
    });
  });

  it('each section loads on its own: one still read while the others are shown', async () => {
    vi.mocked(api.listSubnets).mockImplementation(() => new Promise(() => undefined));
    vi.mocked(api.listInternetGateways).mockImplementation(() => new Promise(() => undefined));
    open();
    await loaded();
    await waitFor(() => {
      expect(text(section('Route tables').findEmptySlot()?.getElement())).toContain('No route tables');
    });
    expect(text(section('Subnets').getElement())).toContain('Loading subnets');
    expect(text(container('Internet gateway'))).toContain('Loading internet gateway');
    expect(rowsOf('Tags')).toHaveLength(2);
  });

  it('an empty answer → "VPC not found" with "View VPCs", and no section or action', async () => {
    answerAll({ found: false });
    const router = open();
    expect(await screen.findByText('VPC not found')).toBeInTheDocument();
    expect(screen.getByText('The emulator holds no VPC with this ID.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'vpc-a' })).toBeInTheDocument();
    expect(screen.queryByText('VPC details')).toBeNull();
    expect(PAGE.findAllTables()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Delete VPC' })).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'View VPCs' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/vpcs');
    });
  });

  it('loading → "Loading VPC"', async () => {
    vi.mocked(api.getVpc).mockImplementation(() => new Promise(() => undefined));
    open();
    expect(await screen.findByText('Loading VPC')).toBeInTheDocument();
    expect(screen.queryByText('VPC details')).toBeNull();
  });

  const failures: [string, RequestFailure, RegExp, boolean?][] = [
    [
      'not implemented',
      { kind: 'not-implemented', operation: 'DescribeVpcs' },
      /Not implemented by the emulator.*DescribeVpcs/,
    ],
    ['access denied', { kind: 'access-denied', operation: 'DescribeVpcs', message: 'no' }, /Access denied/],
    [
      'the emulator not answering',
      { kind: 'emulator-did-not-answer', operation: 'DescribeVpcs', message: 'timed out' },
      /The emulator did not answer/,
    ],
    [
      'the engine not answering',
      { kind: 'engine-did-not-answer', operation: 'DescribeVpcs' },
      /engine.*did not answer/,
    ],
    [
      'another code and message',
      { kind: 'other', operation: 'DescribeVpcs', code: 'InternalError', message: 'broke' },
      /InternalError.*broke/,
    ],
    ['not connected', { kind: 'other', operation: 'DescribeVpcs', code: 'X' }, /Not started on port/, true],
  ];
  for (const [kind, failure, shown, down] of failures) {
    it(`a failed read of the VPC, ${kind} → its state with "Retry", which reads again`, async () => {
      if (down === true) {
        connection.value = { result: notStartedResult(), engineOrigin: ENGINE };
      }
      vi.mocked(api.getVpc).mockRejectedValue(new RequestError(failure));
      open();
      const main = () => document.querySelector('main') ?? document.body;
      await waitFor(() => {
        expect(text(main())).toMatch(shown);
      });
      expect(screen.queryByText('VPC details')).toBeNull();
      const calls = vi.mocked(api.getVpc).mock.calls.length;
      vi.mocked(api.getVpc).mockResolvedValue({ found: true, value: APP });
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await loaded();
      expect(vi.mocked(api.getVpc).mock.calls.length).toBe(calls + 1);
    });
  }

  it('"Refresh" reads the VPC, its DNS settings and every section again', async () => {
    open();
    await loaded();
    await waitFor(() => {
      expect(detail('DNS resolution')).toBe('On');
      expect(text(container('Internet gateway'))).toContain('No internet gateway');
    });
    const before = {
      vpc: vi.mocked(api.getVpc).mock.calls.length,
      dns: vi.mocked(api.getDnsSetting).mock.calls.length,
      subnets: vi.mocked(api.listSubnets).mock.calls.length,
      tables: vi.mocked(api.listRouteTables).mock.calls.length,
      gateways: vi.mocked(api.listInternetGateways).mock.calls.length,
    };
    vi.mocked(api.getVpc).mockResolvedValue({ found: true, value: vpc('vpc-a', 'renamed') });
    vi.mocked(api.listSubnets).mockResolvedValue({ items: [subnet('subnet-9', 'new')] });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'renamed' })).toBeInTheDocument();
    await waitFor(() => {
      expect(rowsOf('Subnets')).toHaveLength(1);
    });
    expect(vi.mocked(api.getVpc).mock.calls.length).toBe(before.vpc + 1);
    expect(vi.mocked(api.getDnsSetting).mock.calls.length).toBe(before.dns + 2);
    expect(vi.mocked(api.listSubnets).mock.calls.length).toBe(before.subnets + 1);
    expect(vi.mocked(api.listRouteTables).mock.calls.length).toBe(before.tables + 1);
    expect(vi.mocked(api.listInternetGateways).mock.calls.length).toBe(before.gateways + 1);
  });

  it('"Delete VPC" confirmed → the VPCs list with "Deleted VPC {name or id}"', async () => {
    vi.mocked(changes.deleteVpc).mockResolvedValue(undefined);
    const router = open();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Delete VPC' }));
    expect(text(await dialog())).toContain('app is deleted from the local emulator with its route tables.');
    await confirmDelete();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/vpcs');
    });
    expect(await screen.findByText('Deleted VPC app')).toBeInTheDocument();
    expect(vi.mocked(changes.deleteVpc).mock.calls[0]?.slice(0, 2)).toEqual([ENGINE, 'vpc-a']);
  });

  it('"Delete VPC" of a VPC without a name → "Deleted VPC {id}"', async () => {
    answerAll({ found: true, value: vpc('vpc-a', undefined) });
    vi.mocked(changes.deleteVpc).mockResolvedValue(undefined);
    open();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Delete VPC' }));
    await confirmDelete();
    expect(await screen.findByText('Deleted VPC vpc-a')).toBeInTheDocument();
  });

  it('a refused delete → the dialog stays with it, and stays when the VPC\'s read then answers "not found"', async () => {
    vi.mocked(changes.deleteVpc).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'DeleteVpc',
        code: 'DependencyViolation',
        message: "The vpc 'vpc-a' has dependencies and cannot be deleted.",
      }),
    );
    const router = open();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Delete VPC' }));
    await confirmDelete();
    const alert = await within(await dialog()).findByRole('alert');
    expect(text(alert)).toContain('DependencyViolation');
    expect(text(alert)).toContain("The vpc 'vpc-a' has dependencies and cannot be deleted.");

    vi.mocked(api.getVpc).mockResolvedValue({ found: false });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('VPC not found')).toBeInTheDocument();
    await settled();
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('DependencyViolation');
    expect(router.state.location.pathname).toBe(PAGE_PATH);
    expect(screen.queryByText(/Deleted VPC/)).toBeNull();
  });

  it("after a delete, the VPC's \"not found\" before the delete's answer is handled and a section's after → the list with the result, no state of this page in its place", async () => {
    let finish: () => void = () => undefined;
    vi.mocked(changes.deleteVpc).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => {
            resolve(undefined);
          };
        }),
    );
    const subnetReads: ((page: api.Page<api.Subnet>) => void)[] = [];
    const router = open();
    await loaded();
    vi.mocked(api.listSubnets).mockImplementation(
      () =>
        new Promise((resolve) => {
          subnetReads.push(resolve);
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete VPC' }));
    await confirmDelete();
    // The VPC's read answers "not found" while the delete is still in flight.
    vi.mocked(api.getVpc).mockResolvedValue({ found: false });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('VPC not found')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    act(() => {
      finish();
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/vpcs');
    });
    act(() => {
      for (const resolve of subnetReads) {
        resolve({ items: [subnet('subnet-late', 'late')] });
      }
    });
    await settled();
    expect(router.state.location.pathname).toBe('/aws/vpc/vpcs');
    expect(screen.getByText('Deleted VPC app')).toBeInTheDocument();
    expect(screen.queryByText('VPC not found')).toBeNull();
    expect(screen.queryByText('subnet-late')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: /VPCs/ })).toBeInTheDocument();
  });

  it('the page names its resources "VPCs" to the frame', async () => {
    open();
    await loaded();
    expect(await screen.findByText('These VPCs are in your local emulator')).toBeInTheDocument();
  });
});
