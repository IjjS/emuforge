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
import { VPC_KEYS } from '../queries';
import * as routeChanges from '../route-changes-api';
import * as changes from '../route-table-changes-api';

// S9 rendered inside the area's layout, with the calls of `api.ts`, `route-table-changes-api.ts` and
// `route-changes-api.ts` answered by the case (their own tests prove the calls against a fake engine).

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, getRouteTable: vi.fn(), listRouteTables: vi.fn() };
});

vi.mock('../route-changes-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../route-changes-api')>();
  return { ...real, deleteRoute: vi.fn(), disassociateSubnet: vi.fn() };
});

vi.mock('../route-table-changes-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../route-table-changes-api')>();
  return { ...real, deleteRouteTable: vi.fn() };
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
/** The query client of the case's page, so a case can ask a read of its own as another part of the page would. */
let queryClient: QueryClient;
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
  queryClient = client;
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

// ---------------------------------------------------------------------------------------------------------------
// What the emulator holds, as the readers answer it.

const PAGE_PATH = '/aws/vpc/route-tables/route-table/rtb-a';

function route(n: number): api.Route {
  return { destination: { kind: 'ipv4', value: `10.${String(n)}.0.0/16` }, target: 'igw-1', state: 'active' };
}

function routeTable(changes: Partial<api.RouteTable> = {}): api.RouteTable {
  return {
    id: 'rtb-a',
    vpcId: 'vpc-a',
    main: false,
    routes: [
      { destination: { kind: 'ipv4', value: '10.0.0.0/16' }, target: 'local', state: 'active' },
      { destination: { kind: 'ipv4', value: '0.0.0.0/0' }, target: 'igw-1', state: 'blackhole' },
    ],
    associations: [{ id: 'rtbassoc-1', subnetId: 'subnet-1', main: false }],
    subnetCount: 1,
    tags: [
      { key: 'Name', value: 'app' },
      { key: 'team', value: 'core' },
    ],
    ...changes,
  };
}

const found = (table: api.RouteTable): api.Read<api.RouteTable> => ({ found: true, value: table });

beforeEach(() => {
  vi.mocked(api.getRouteTable).mockResolvedValue(found(routeTable()));
  vi.mocked(api.listRouteTables).mockResolvedValue({ items: [] });
});

const PAGE = createWrapper(document.body);
const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The table whose header reads `title`. */
function section(title: string) {
  const match = PAGE.findAllTables().find((each) => text(each.findHeaderSlot()?.getElement()).startsWith(title));
  if (match === undefined) {
    throw new Error(`no table ${title}`);
  }
  return match;
}

function rowsOf(title: string): string[][] {
  return (section(title).findRows() ?? []).map((row) =>
    [...row.getElement().querySelectorAll('td, th')]
      .filter((cell) => !/selection-control/.test(cell.className) && cell.querySelector('input') === null)
      .map((cell) => text(cell)),
  );
}

function details() {
  const found = PAGE.findKeyValuePairs();
  if (found === null) {
    throw new Error('no details');
  }
  return found;
}

function detail(label: string): HTMLElement {
  const pair = (details().findItems() ?? []).find((item) => text(item.findLabel()?.getElement()) === label);
  if (pair === undefined) {
    throw new Error(`no detail ${label}`);
  }
  return pair.findValue()?.getElement() as HTMLElement;
}

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

function reasonOf(element: Element): string {
  const ids = (element.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => id !== '');
  return ids
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();
}

async function loaded() {
  await screen.findByText('Route table details');
}

async function confirmDelete() {
  const shown = await screen.findByRole('dialog');
  fireEvent.change(within(shown).getByRole('textbox'), { target: { value: 'delete' } });
  fireEvent.click(within(shown).getByRole('button', { name: 'Delete' }));
}

async function settled() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const nextPage = (title: string) => {
  fireEvent.click(section(title).findPagination()?.findNextPageButton().getElement() as HTMLElement);
};

// ---------------------------------------------------------------------------------------------------------------

describe('a route table', () => {
  it('shows the exact Name tag and identifies the heading by its escaped name', async () => {
    vi.mocked(api.getRouteTable).mockResolvedValue(found(routeTable({ tags: [{ key: 'Name', value: 'p664 a  b' }] })));
    open();
    await loaded();
    const identity = String.raw`p664 a\u0020\u0020b`;
    const heading = await waitFor(() => {
      const headingText = PAGE.findContentLayout()?.findHeader()?.findHeader()?.findHeadingText().getElement();
      const title = headingText?.closest('h1');
      if (title === undefined || title === null) throw new Error('Missing resource heading');
      expect(title).toHaveAccessibleName(identity);
      return title;
    });
    const name = within(heading).getByText('p664 a  b', { normalizer: (value) => value });
    expect(name.parentElement?.textContent).toBe(`p664 a  b (${identity})`);
  });

  it('the heading is its name; "Route table details" with the ID and a copy control, the VPC ID linked and "Main"', async () => {
    open();
    await loaded();
    expect(screen.getByRole('heading', { level: 1, name: 'app' })).toBeInTheDocument();
    expect(vi.mocked(api.getRouteTable).mock.calls[0]?.slice(0, 2)).toEqual([ENGINE, 'rtb-a']);
    expect(text(detail('Route table ID'))).toContain('rtb-a');
    expect(within(detail('Route table ID')).getByRole('button', { name: 'Copy Route table ID' })).toBeInTheDocument();
    expect(within(detail('VPC ID')).getByRole('link', { name: 'vpc-a' })).toHaveAttribute(
      'href',
      '/aws/vpc/vpcs/vpc/vpc-a',
    );
    expect(text(detail('Main'))).toBe('No');
  });

  it('without a name the heading is its ID; a main table reads "Main" "Yes"', async () => {
    vi.mocked(api.getRouteTable).mockResolvedValue(found(routeTable({ tags: [], main: true })));
    open();
    await loaded();
    expect(screen.getByRole('heading', { level: 1, name: 'rtb-a' })).toBeInTheDocument();
    expect(text(detail('Main'))).toBe('Yes');
  });

  it('"Routes" as the routes table shows them, in the API\'s order', async () => {
    open();
    await loaded();
    expect(rowsOf('Routes')).toEqual([
      ['10.0.0.0/16', 'local', 'active'],
      ['0.0.0.0/0', 'igw-1', 'blackhole'],
    ]);
  });

  it('26 routes → 25 on the first page and one on the second', async () => {
    const routes = Array.from({ length: 26 }, (_, n) => route(n));
    vi.mocked(api.getRouteTable).mockResolvedValue(found(routeTable({ routes })));
    open();
    await loaded();
    expect(rowsOf('Routes')).toHaveLength(25);
    expect(rowsOf('Routes')[0]?.[0]).toBe('10.0.0.0/16');
    nextPage('Routes');
    await waitFor(() => {
      expect(rowsOf('Routes')).toEqual([['10.25.0.0/16', 'igw-1', 'active']]);
    });
  });

  it('"Subnet associations": a row per association with a subnet, the ID linked, and the association ID; the main one has none', async () => {
    vi.mocked(api.getRouteTable).mockResolvedValue(
      found(
        routeTable({
          associations: [
            { id: 'rtbassoc-m', main: true },
            { id: 'rtbassoc-1', subnetId: 'subnet-1', main: false },
          ],
        }),
      ),
    );
    open();
    await loaded();
    expect(rowsOf('Subnet associations')).toEqual([['subnet-1', 'rtbassoc-1']]);
    expect(within(section('Subnet associations').getElement()).getByRole('link', { name: 'subnet-1' })).toHaveAttribute(
      'href',
      '/aws/vpc/subnets/subnet/subnet-1',
    );
  });

  it('no subnet association → "No subnet associations" / "No subnet is associated with this route table."', async () => {
    vi.mocked(api.getRouteTable).mockResolvedValue(
      found(routeTable({ associations: [{ id: 'rtbassoc-m', main: true }], subnetCount: 0 })),
    );
    open();
    await loaded();
    expect(screen.getByText('No subnet associations')).toBeInTheDocument();
    expect(screen.getByText('No subnet is associated with this route table.')).toBeInTheDocument();
  });

  it('26 associations → 25 on the first page and one on the second', async () => {
    const associations = Array.from({ length: 26 }, (_, n) => ({
      id: `rtbassoc-${String(n)}`,
      subnetId: `subnet-${String(n)}`,
      main: false,
    }));
    vi.mocked(api.getRouteTable).mockResolvedValue(found(routeTable({ associations, subnetCount: 26 })));
    open();
    await loaded();
    expect(rowsOf('Subnet associations')).toHaveLength(25);
    nextPage('Subnet associations');
    await waitFor(() => {
      expect(rowsOf('Subnet associations')).toEqual([['subnet-25', 'rtbassoc-25']]);
    });
  });

  it('"Tags" as the tags table shows them', async () => {
    open();
    await loaded();
    expect(rowsOf('Tags')).toEqual([
      ['Name', 'app'],
      ['team', 'core'],
    ]);
  });

  it('an empty answer → "Route table not found" with "View route tables", and no section or action', async () => {
    vi.mocked(api.getRouteTable).mockResolvedValue({ found: false });
    const router = open();
    expect(await screen.findByText('Route table not found')).toBeInTheDocument();
    expect(screen.getByText('The emulator holds no route table with this ID.')).toBeInTheDocument();
    expect(screen.queryByText('Route table details')).toBeNull();
    expect(PAGE.findAllTables()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Delete route table' })).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'View route tables' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/route-tables');
    });
  });

  it('loading → "Loading route table"', async () => {
    vi.mocked(api.getRouteTable).mockImplementation(() => new Promise(() => undefined));
    open();
    expect(await screen.findByText('Loading route table')).toBeInTheDocument();
  });

  const failures: [string, RequestFailure, RegExp, boolean?][] = [
    [
      'not implemented',
      { kind: 'not-implemented', operation: 'DescribeRouteTables' },
      /Not implemented by the emulator.*DescribeRouteTables/,
    ],
    ['access denied', { kind: 'access-denied', operation: 'DescribeRouteTables', message: 'no' }, /Access denied/],
    [
      'the emulator not answering',
      { kind: 'emulator-did-not-answer', operation: 'DescribeRouteTables', message: 'timed out' },
      /The emulator did not answer/,
    ],
    [
      'the engine not answering',
      { kind: 'engine-did-not-answer', operation: 'DescribeRouteTables' },
      /engine.*did not answer/,
    ],
    [
      'another code and message',
      { kind: 'other', operation: 'DescribeRouteTables', code: 'InternalError', message: 'broke' },
      /InternalError.*broke/,
    ],
    ['not connected', { kind: 'other', operation: 'DescribeRouteTables', code: 'X' }, /Not started on port/, true],
  ];
  for (const [kind, failure, shown, down] of failures) {
    it(`a failed read, ${kind} → its state with "Retry", which reads again`, async () => {
      if (down === true) {
        connection.value = { result: notStartedResult(), engineOrigin: ENGINE };
      }
      vi.mocked(api.getRouteTable).mockRejectedValue(new RequestError(failure));
      open();
      await waitFor(() => {
        expect(text(document.querySelector('main') ?? document.body)).toMatch(shown);
      });
      const calls = vi.mocked(api.getRouteTable).mock.calls.length;
      vi.mocked(api.getRouteTable).mockResolvedValue(found(routeTable()));
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await loaded();
      expect(vi.mocked(api.getRouteTable).mock.calls.length).toBe(calls + 1);
    });
  }

  it('"Refresh" reads the table again', async () => {
    open();
    await loaded();
    const calls = vi.mocked(api.getRouteTable).mock.calls.length;
    vi.mocked(api.getRouteTable).mockResolvedValue(found(routeTable({ tags: [{ key: 'Name', value: 'renamed' }] })));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'renamed' })).toBeInTheDocument();
    expect(vi.mocked(api.getRouteTable).mock.calls.length).toBe(calls + 1);
  });

  it('"Delete route table" for a main table is unavailable with its reason', async () => {
    vi.mocked(api.getRouteTable).mockResolvedValue(found(routeTable({ main: true })));
    open();
    await loaded();
    const button = screen.getByRole('button', { name: 'Delete route table' });
    expect(isDisabled(button)).toBe(true);
    expect(reasonOf(button)).toBe("A VPC's main route table cannot be deleted.");
  });

  it('confirmed for another → the route tables list with "Deleted route table {name or id}"', async () => {
    vi.mocked(changes.deleteRouteTable).mockResolvedValue(undefined);
    const router = open();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Delete route table' }));
    await confirmDelete();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/route-tables');
    });
    expect(await screen.findByText('Deleted route table app')).toBeInTheDocument();
    expect(vi.mocked(changes.deleteRouteTable).mock.calls[0]?.slice(0, 2)).toEqual([ENGINE, 'rtb-a']);
  });

  it('a table without a name is named by its ID in the result', async () => {
    vi.mocked(api.getRouteTable).mockResolvedValue(found(routeTable({ tags: [] })));
    vi.mocked(changes.deleteRouteTable).mockResolvedValue(undefined);
    open();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Delete route table' }));
    await confirmDelete();
    expect(await screen.findByText('Deleted route table rtb-a')).toBeInTheDocument();
  });

  it('a refusal → the dialog stays with it, and stays when the table\'s read then answers "not found"', async () => {
    vi.mocked(changes.deleteRouteTable).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'DeleteRouteTable',
        code: 'DependencyViolation',
        message: "The routeTable 'rtb-a' has dependencies and cannot be deleted.",
      }),
    );
    const router = open();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Delete route table' }));
    await confirmDelete();
    const shown = await screen.findByRole('dialog');
    const alert = await within(shown).findByRole('alert');
    expect(text(alert)).toContain('DependencyViolation');
    expect(text(alert)).toContain("The routeTable 'rtb-a' has dependencies and cannot be deleted.");
    vi.mocked(api.getRouteTable).mockResolvedValue({ found: false });
    fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' })[0] as HTMLElement);
    expect(await screen.findByText('Route table not found')).toBeInTheDocument();
    await settled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(text(within(screen.getByRole('dialog')).getByRole('alert'))).toContain('DependencyViolation');
    expect(router.state.location.pathname).toBe(PAGE_PATH);
  });

  it('after a delete, the table\'s "not found" answering before the delete\'s answer is handled → the list opens with the result', async () => {
    let finish: () => void = () => undefined;
    vi.mocked(changes.deleteRouteTable).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => {
            resolve(undefined);
          };
        }),
    );
    const router = open();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Delete route table' }));
    await confirmDelete();
    await waitFor(() => {
      expect(changes.deleteRouteTable).toHaveBeenCalledTimes(1);
    });
    vi.mocked(api.getRouteTable).mockResolvedValue({ found: false });
    fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' })[0] as HTMLElement);
    expect(await screen.findByText('Route table not found')).toBeInTheDocument();
    act(() => {
      finish();
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/route-tables');
    });
    expect(await screen.findByText('Deleted route table app')).toBeInTheDocument();
    await settled();
    expect(screen.queryByText('Route table not found')).toBeNull();
    expect(screen.getByText('Deleted route table app')).toBeInTheDocument();
  });

  it('the page names its resources "route tables" to the frame', async () => {
    open();
    await loaded();
    expect(await screen.findByText('These route tables are in your local emulator')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Its routes and associations (unit s5).

/** Selects row `n` (from 1) of the table whose header reads `title`. */
function select(title: string, n: number) {
  fireEvent.click(section(title).findRowSelectionArea(n)?.getElement() as HTMLElement);
}

function button(title: string, name: string): HTMLElement {
  return within(section(title).findHeaderSlot()?.getElement() as HTMLElement).getByRole('button', { name });
}

/** Every read of the table from now on held, each until the case answers it, in the order they were asked. */
function holdReads(): ((table: api.RouteTable) => void)[] {
  const answers: ((table: api.RouteTable) => void)[] = [];
  vi.mocked(api.getRouteTable).mockImplementation(
    () =>
      new Promise((resolve) => {
        answers.push((table) => {
          resolve(found(table));
        });
      }),
  );
  return answers;
}

/** A read of the table asked now, while the page shows it, as a change elsewhere on the page would ask it. */
function askReadNow() {
  void queryClient.invalidateQueries({ queryKey: VPC_KEYS.routeTable('rtb-a') });
}

describe("a route table's routes and associations", () => {
  it('"Add route" leads to the table\'s add-route address; "Associate subnet" to its associate-subnet address', async () => {
    open();
    await loaded();
    const add = screen.getByRole('link', { name: 'Add route' });
    expect(add).toHaveAttribute('href', '/aws/vpc/route-tables/route-table/rtb-a/add-route');
    expect(screen.getByRole('link', { name: 'Associate subnet' })).toHaveAttribute(
      'href',
      '/aws/vpc/route-tables/route-table/rtb-a/associate-subnet',
    );
  });

  it('the empty state\'s "Associate subnet" leads to the associate-subnet address too', async () => {
    vi.mocked(api.getRouteTable).mockResolvedValue(
      found(routeTable({ associations: [{ id: 'rtbassoc-m', main: true }], subnetCount: 0 })),
    );
    open();
    await loaded();
    const links = screen.getAllByRole('link', { name: 'Associate subnet' });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute('href', '/aws/vpc/route-tables/route-table/rtb-a/associate-subnet');
    }
  });

  it('"Delete route": none selected → "Select one route."; the local route → "The local route cannot be deleted."', async () => {
    open();
    await loaded();
    expect(isDisabled(button('Routes', 'Delete route'))).toBe(true);
    expect(reasonOf(button('Routes', 'Delete route'))).toBe('Select one route.');
    select('Routes', 1);
    await waitFor(() => {
      expect(reasonOf(button('Routes', 'Delete route'))).toBe('The local route cannot be deleted.');
    });
    expect(isDisabled(button('Routes', 'Delete route'))).toBe(true);
  });

  it('a route with an IPv6 destination or a prefix list\'s ID → "Studio deletes a route by its IPv4 destination only."', async () => {
    vi.mocked(api.getRouteTable).mockResolvedValue(
      found(
        routeTable({
          routes: [
            { destination: { kind: 'ipv6', value: '::/0' }, target: 'igw-1', state: 'active' },
            { destination: { kind: 'prefix-list', value: 'pl-1' }, target: 'vpce-1', state: 'active' },
          ],
        }),
      ),
    );
    open();
    await loaded();
    for (const n of [1, 2]) {
      select('Routes', n);
      await waitFor(() => {
        expect(reasonOf(button('Routes', 'Delete route'))).toBe('Studio deletes a route by its IPv4 destination only.');
      });
      expect(isDisabled(button('Routes', 'Delete route'))).toBe(true);
    }
  });

  it('a route selected and confirmed → its delete with its destination, "Deleted the route {destination}", the table read again', async () => {
    vi.mocked(routeChanges.deleteRoute).mockResolvedValue(undefined);
    open();
    await loaded();
    select('Routes', 2);
    await waitFor(() => {
      expect(isDisabled(button('Routes', 'Delete route'))).toBe(false);
    });
    fireEvent.click(button('Routes', 'Delete route'));
    const shown = await screen.findByRole('dialog');
    expect(text(shown)).toContain('The route 0.0.0.0/0 to igw-1 is removed from app.');
    const calls = vi.mocked(api.getRouteTable).mock.calls.length;
    vi.mocked(api.getRouteTable).mockResolvedValue(found(routeTable({ routes: routeTable().routes.slice(0, 1) })));
    await confirmDelete();
    expect(await screen.findByText('Deleted the route 0.0.0.0/0')).toBeInTheDocument();
    expect(vi.mocked(routeChanges.deleteRoute).mock.calls[0]?.slice(0, 3)).toEqual([ENGINE, 'rtb-a', '0.0.0.0/0']);
    await waitFor(() => {
      expect(rowsOf('Routes')).toEqual([['10.0.0.0/16', 'local', 'active']]);
    });
    expect(vi.mocked(api.getRouteTable).mock.calls.length).toBeGreaterThan(calls);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it("a route's delete that fails → the failure in the flash, the dialog closed and the row stays", async () => {
    vi.mocked(routeChanges.deleteRoute).mockRejectedValue(
      new RequestError({ kind: 'other', operation: 'DeleteRoute', code: 'InvalidRoute.NotFound', message: 'no route' }),
    );
    open();
    await loaded();
    select('Routes', 2);
    fireEvent.click(button('Routes', 'Delete route'));
    await confirmDelete();
    await waitFor(() => {
      expect(text(document.body)).toContain('InvalidRoute.NotFound');
    });
    expect(text(document.body)).toContain('no route');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(rowsOf('Routes')).toHaveLength(2);
  });

  it('"Disassociate": none selected → "Select one association."; one selected → "Disassociate subnet?" naming the subnet and the table', async () => {
    open();
    await loaded();
    expect(isDisabled(button('Subnet associations', 'Disassociate'))).toBe(true);
    expect(reasonOf(button('Subnet associations', 'Disassociate'))).toBe('Select one association.');
    select('Subnet associations', 1);
    await waitFor(() => {
      expect(isDisabled(button('Subnet associations', 'Disassociate'))).toBe(false);
    });
    fireEvent.click(button('Subnet associations', 'Disassociate'));
    const shown = await screen.findByRole('dialog');
    expect(text(shown)).toContain('Disassociate subnet?');
    expect(text(shown)).toContain('subnet-1 is no longer associated with app.');
    expect(within(shown).queryByRole('textbox')).toBeNull();
  });

  it('confirmed with its button → sent with the association\'s ID, "Disassociated {subnet id}", the table read again', async () => {
    vi.mocked(routeChanges.disassociateSubnet).mockResolvedValue(undefined);
    open();
    await loaded();
    select('Subnet associations', 1);
    fireEvent.click(button('Subnet associations', 'Disassociate'));
    const shown = await screen.findByRole('dialog');
    vi.mocked(api.getRouteTable).mockResolvedValue(found(routeTable({ associations: [], subnetCount: 0 })));
    fireEvent.click(within(shown).getByRole('button', { name: 'Disassociate' }));
    expect(await screen.findByText('Disassociated subnet-1')).toBeInTheDocument();
    expect(vi.mocked(routeChanges.disassociateSubnet).mock.calls[0]?.slice(0, 2)).toEqual([ENGINE, 'rtbassoc-1']);
    expect(await screen.findByText('No subnet associations')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a disassociation that fails → the failure in the flash, the dialog closed and the row stays', async () => {
    vi.mocked(routeChanges.disassociateSubnet).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'DisassociateRouteTable' }),
    );
    open();
    await loaded();
    select('Subnet associations', 1);
    fireEvent.click(button('Subnet associations', 'Disassociate'));
    const shown = await screen.findByRole('dialog');
    fireEvent.click(within(shown).getByRole('button', { name: 'Disassociate' }));
    await waitFor(() => {
      expect(text(document.body)).toMatch(/Not implemented by the emulator.*DisassociateRouteTable/);
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(rowsOf('Subnet associations')).toEqual([['subnet-1', 'rtbassoc-1']]);
  });

  it("after a route's delete, a read asked before it answering last → the routes settle on the newest read, and the result stays", async () => {
    let finish: () => void = () => undefined;
    vi.mocked(routeChanges.deleteRoute).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => {
            resolve(undefined);
          };
        }),
    );
    open();
    await loaded();
    select('Routes', 2);
    fireEvent.click(button('Routes', 'Delete route'));
    await confirmDelete();
    await waitFor(() => {
      expect(routeChanges.deleteRoute).toHaveBeenCalledTimes(1);
    });
    const answers = holdReads();
    askReadNow();
    await waitFor(() => {
      expect(answers).toHaveLength(1);
    });
    act(() => {
      finish();
    });
    expect(await screen.findByText('Deleted the route 0.0.0.0/0')).toBeInTheDocument();
    await waitFor(() => {
      expect(answers.length).toBeGreaterThanOrEqual(2);
    });
    const newest = answers.length - 1;
    act(() => {
      answers[newest]?.(routeTable({ routes: routeTable().routes.slice(0, 1) }));
    });
    await waitFor(() => {
      expect(rowsOf('Routes')).toEqual([['10.0.0.0/16', 'local', 'active']]);
    });
    act(() => {
      for (let index = 0; index < newest; index += 1) {
        answers[index]?.(routeTable());
      }
    });
    await settled();
    expect(rowsOf('Routes')).toEqual([['10.0.0.0/16', 'local', 'active']]);
    expect(screen.getByText('Deleted the route 0.0.0.0/0')).toBeInTheDocument();
  });

  it('after a disassociation, a read asked before it answering last → the associations settle on the newest read, and the result stays', async () => {
    let finish: () => void = () => undefined;
    vi.mocked(routeChanges.disassociateSubnet).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => {
            resolve(undefined);
          };
        }),
    );
    open();
    await loaded();
    select('Subnet associations', 1);
    fireEvent.click(button('Subnet associations', 'Disassociate'));
    const shown = await screen.findByRole('dialog');
    fireEvent.click(within(shown).getByRole('button', { name: 'Disassociate' }));
    await waitFor(() => {
      expect(routeChanges.disassociateSubnet).toHaveBeenCalledTimes(1);
    });
    const answers = holdReads();
    askReadNow();
    await waitFor(() => {
      expect(answers).toHaveLength(1);
    });
    act(() => {
      finish();
    });
    expect(await screen.findByText('Disassociated subnet-1')).toBeInTheDocument();
    await waitFor(() => {
      expect(answers.length).toBeGreaterThanOrEqual(2);
    });
    const newest = answers.length - 1;
    act(() => {
      answers[newest]?.(routeTable({ associations: [], subnetCount: 0 }));
    });
    expect(await screen.findByText('No subnet associations')).toBeInTheDocument();
    act(() => {
      for (let index = 0; index < newest; index += 1) {
        answers[index]?.(routeTable());
      }
    });
    await settled();
    expect(screen.getByText('No subnet associations')).toBeInTheDocument();
    expect(screen.getByText('Disassociated subnet-1')).toBeInTheDocument();
  });
});
