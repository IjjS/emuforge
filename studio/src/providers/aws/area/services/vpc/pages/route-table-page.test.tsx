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
import * as changes from '../route-table-changes-api';

// S9 rendered inside the area's layout, with the calls of `api.ts` and `route-table-changes-api.ts` answered by the
// case (`api.test.ts` and `route-table-changes-api.test.ts` prove the calls against a fake engine).

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, getRouteTable: vi.fn(), listRouteTables: vi.fn() };
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
