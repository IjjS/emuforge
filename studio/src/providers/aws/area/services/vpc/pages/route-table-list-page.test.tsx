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

// S7 rendered inside the area's layout, with the calls of `api.ts` and `route-table-changes-api.ts` answered by the
// case (`api.test.ts` and `route-table-changes-api.test.ts` prove the calls against a fake engine).

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, listRouteTables: vi.fn() };
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

function open(path = '/aws/vpc/route-tables') {
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
// Route tables and readers.

function routeTable(id: string, name: string | undefined, changes: Partial<api.RouteTable> = {}): api.RouteTable {
  return {
    id,
    vpcId: 'vpc-a',
    main: false,
    routes: [{ destination: { kind: 'ipv4', value: '10.0.0.0/16' }, target: 'local', state: 'active' }],
    associations: [],
    subnetCount: 0,
    tags: name === undefined ? [] : [{ key: 'Name', value: name }],
    ...changes,
  };
}

/** `listRouteTables` answering each request from `pages`, by its name and its token (`''` for none). */
function answer(pages: Record<string, api.Page<api.RouteTable>>) {
  vi.mocked(api.listRouteTables).mockImplementation((_endpoint, filters, token) =>
    Promise.resolve(pages[`${filters.name ?? ''}|${token ?? ''}`] ?? { items: [] }),
  );
}

const PAGE = createWrapper(document.body);

function table() {
  const found = PAGE.findTable();
  expect(found).not.toBeNull();
  return found as NonNullable<typeof found>;
}

const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

function rows(): string[][] {
  return (table().findRows() ?? []).map((row) =>
    [...row.getElement().querySelectorAll('td, th')]
      .filter((cell) => !/selection-control/.test(cell.className) && cell.querySelector('input') === null)
      .map(text),
  );
}

async function expectRows(expected: string[][]) {
  await waitFor(() => {
    expect(rows()).toEqual(expected);
  });
}

function action(name: string): HTMLElement {
  return within(table().getElement()).getByRole('button', { name });
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

function selectRow(name: string) {
  fireEvent.click(screen.getByRole('radio', { name }));
}

const lastCall = () => vi.mocked(api.listRouteTables).mock.calls.at(-1);

function dialog(): Promise<HTMLElement> {
  return screen.findByRole('dialog');
}

async function confirmDelete() {
  const shown = await dialog();
  fireEvent.change(within(shown).getByRole('textbox'), { target: { value: 'delete' } });
  fireEvent.click(within(shown).getByRole('button', { name: 'Delete' }));
}

const APP = routeTable('rtb-a', 'app', {
  associations: [{ id: 'rtbassoc-1', subnetId: 'subnet-1', main: false }],
  subnetCount: 1,
});
const MAIN = routeTable('rtb-m', undefined, {
  vpcId: 'vpc-d',
  main: true,
  associations: [{ id: 'rtbassoc-m', main: true }],
});
const APP_ROW = ['app', 'rtb-a', 'vpc-a', 'No', '1'];
const MAIN_ROW = ['-', 'rtb-m', 'vpc-d', 'Yes', '0'];

/** Lets every answer already given settle (order, not time; see EC2's list test). */
async function settled() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// ---------------------------------------------------------------------------------------------------------------

describe('the route table list', () => {
  it('a row per table with name, route table ID (to its page), VPC ID (to the VPC), "Main" Yes or No and the associated subnets', async () => {
    answer({ '|': { items: [APP, MAIN] } });
    const router = open();
    await expectRows([APP_ROW, MAIN_ROW]);
    expect((table().findColumnHeaders() ?? []).map((header) => text(header.getElement())).slice(1)).toEqual([
      'Name',
      'Route table ID',
      'VPC ID',
      'Main',
      'Associated subnets',
    ]);
    expect(screen.getByRole('link', { name: 'vpc-a' })).toHaveAttribute('href', '/aws/vpc/vpcs/vpc/vpc-a');
    const link = screen.getByRole('link', { name: 'rtb-a' });
    expect(link).toHaveAttribute('href', '/aws/vpc/route-tables/route-table/rtb-a');
    fireEvent.click(link);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/route-tables/route-table/rtb-a');
    });
  });

  it('none, no filter → "No route tables" / "The emulator holds no route table." with "Create route table"', async () => {
    answer({});
    const router = open();
    expect(await screen.findByText('No route tables')).toBeInTheDocument();
    expect(screen.getByText('The emulator holds no route table.')).toBeInTheDocument();
    const slot = table().findEmptySlot()?.getElement() as HTMLElement;
    fireEvent.click(within(slot).getByRole('link', { name: 'Create route table' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/route-tables/create');
    });
  });

  it('none with a filter → "No route tables match" with "Clear filter", which empties it', async () => {
    answer({ '|': { items: [APP] } });
    open();
    await expectRows([APP_ROW]);
    PAGE.findTextFilter()?.findInput().setInputValue('zzz');
    await waitFor(() => {
      expect(lastCall()?.slice(1, 3)).toEqual([{ name: 'zzz' }, undefined]);
    });
    expect(await screen.findByText('No route tables match')).toBeInTheDocument();
    expect(screen.queryByText('No route tables')).toBeNull();
    fireEvent.click(
      within(table().findEmptySlot()?.getElement() as HTMLElement).getByRole('button', { name: 'Clear filter' }),
    );
    await expectRows([APP_ROW]);
    expect(lastCall()?.slice(1, 3)).toEqual([{}, undefined]);
    expect(PAGE.findTextFilter()?.findInput().getInputValue()).toBe('');
  });

  it("the table's description is the name filter's", async () => {
    answer({ '|': { items: [APP] } });
    open();
    expect(await screen.findByText('The name filter matches the Name tag and is case-sensitive.')).toBeInTheDocument();
    expect(PAGE.findTextFilter()?.findInput().findNativeInput().getElement()).toHaveAttribute(
      'placeholder',
      'Find by name',
    );
  });

  it('loading → "Loading route tables"', async () => {
    vi.mocked(api.listRouteTables).mockImplementation(() => new Promise(() => undefined));
    open();
    expect(await screen.findByText('Loading route tables')).toBeInTheDocument();
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
      vi.mocked(api.listRouteTables).mockRejectedValue(new RequestError(failure));
      open();
      const slot = () => table().findEmptySlot()?.getElement() as HTMLElement;
      await waitFor(() => {
        expect(slot().textContent).toMatch(shown);
      });
      const calls = vi.mocked(api.listRouteTables).mock.calls.length;
      answer({ '|': { items: [APP] } });
      fireEvent.click(within(slot()).getByRole('button', { name: 'Retry' }));
      await expectRows([APP_ROW]);
      expect(vi.mocked(api.listRouteTables).mock.calls.length).toBe(calls + 1);
    });
  }

  it('a text in "Find by name" → asked from the first page; the next page asks with the token', async () => {
    answer({
      '|': { items: [APP], nextToken: 'tok-1' },
      'ap|': { items: [APP], nextToken: 'tok-ap' },
      'ap|tok-ap': { items: [routeTable('rtb-b', 'apple')] },
    });
    open();
    await expectRows([APP_ROW]);
    PAGE.findTextFilter()?.findInput().setInputValue('ap');
    await waitFor(() => {
      expect(lastCall()?.slice(1, 3)).toEqual([{ name: 'ap' }, undefined]);
    });
    await expectRows([APP_ROW]);
    fireEvent.click(table().findPagination()?.findNextPageButton().getElement() as HTMLElement);
    await expectRows([['apple', 'rtb-b', 'vpc-a', 'No', '0']]);
    expect(lastCall()?.slice(1, 3)).toEqual([{ name: 'ap' }, 'tok-ap']);
  });

  it('"Refresh" reads the page again', async () => {
    answer({ '|': { items: [APP] } });
    open();
    await expectRows([APP_ROW]);
    const calls = vi.mocked(api.listRouteTables).mock.calls.length;
    answer({ '|': { items: [APP, MAIN] } });
    fireEvent.click(action('Refresh'));
    await expectRows([APP_ROW, MAIN_ROW]);
    expect(vi.mocked(api.listRouteTables).mock.calls.length).toBe(calls + 1);
  });

  it('no row selected → "Delete" unavailable with "Select one route table."; a main table → "A VPC\'s main route table cannot be deleted."', async () => {
    answer({ '|': { items: [APP, MAIN] } });
    open();
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    expect(isDisabled(action('Delete'))).toBe(true);
    expect(reasonOf(action('Delete'))).toBe('Select one route table.');
    selectRow('rtb-m');
    expect(isDisabled(action('Delete'))).toBe(true);
    expect(reasonOf(action('Delete'))).toBe("A VPC's main route table cannot be deleted.");
    selectRow('app');
    expect(isDisabled(action('Delete'))).toBe(false);
  });

  it('another selected and confirmed → deleted, "Deleted route table {name or id}" shown and the list read again', async () => {
    const bare = routeTable('rtb-b', undefined);
    answer({ '|': { items: [APP, bare, MAIN] } });
    vi.mocked(changes.deleteRouteTable).mockResolvedValue(undefined);
    open();
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    selectRow('app');
    fireEvent.click(action('Delete'));
    expect(text(await dialog())).toContain('app is deleted from the local emulator with its routes.');
    const calls = vi.mocked(api.listRouteTables).mock.calls.length;
    answer({ '|': { items: [bare, MAIN] } });
    await confirmDelete();
    expect(await screen.findByText('Deleted route table app')).toBeInTheDocument();
    expect(vi.mocked(changes.deleteRouteTable).mock.calls[0]?.slice(0, 2)).toEqual([ENGINE, 'rtb-a']);
    await expectRows([['-', 'rtb-b', 'vpc-a', 'No', '0'], MAIN_ROW]);
    expect(vi.mocked(api.listRouteTables).mock.calls.length).toBeGreaterThan(calls);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    selectRow('rtb-b');
    fireEvent.click(action('Delete'));
    answer({ '|': { items: [MAIN] } });
    await confirmDelete();
    expect(await screen.findByText('Deleted route table rtb-b')).toBeInTheDocument();
  });

  it('a refused delete → the dialog stays with the refusal and the row stays', async () => {
    answer({ '|': { items: [APP] } });
    vi.mocked(changes.deleteRouteTable).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'DeleteRouteTable',
        code: 'DependencyViolation',
        message: "The routeTable 'rtb-a' has dependencies and cannot be deleted.",
      }),
    );
    open();
    await expectRows([APP_ROW]);
    const calls = vi.mocked(api.listRouteTables).mock.calls.length;
    selectRow('app');
    fireEvent.click(action('Delete'));
    await confirmDelete();
    const shown = await dialog();
    const alert = await within(shown).findByRole('alert');
    expect(text(alert)).toContain('DependencyViolation');
    expect(text(alert)).toContain("The routeTable 'rtb-a' has dependencies and cannot be deleted.");
    await settled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(rows()).toEqual([APP_ROW]);
    expect(vi.mocked(api.listRouteTables).mock.calls.length).toBe(calls);
    expect(screen.queryByText(/Deleted route table/)).toBeNull();
  });

  it('"Create route table" leads to the create address; the page names its resources "route tables" to the frame', async () => {
    answer({ '|': { items: [APP] } });
    const router = open();
    expect(await screen.findByText('These route tables are in your local emulator')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /Route tables/ })).toBeInTheDocument();
    fireEvent.click(within(table().getElement()).getByRole('link', { name: 'Create route table' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/route-tables/create');
    });
  });

  it('after a delete, the reads that follow answering the later one first → the screen settles on the newest, without the deleted table', async () => {
    const other = routeTable('rtb-b', 'api');
    const reads: { resolve: (page: api.Page<api.RouteTable>) => void }[] = [];
    vi.mocked(api.listRouteTables).mockImplementation(
      () =>
        new Promise((resolve) => {
          reads.push({ resolve });
        }),
    );
    vi.mocked(changes.deleteRouteTable).mockResolvedValue(undefined);
    open();
    await waitFor(() => {
      expect(reads).toHaveLength(1);
    });
    act(() => {
      reads[0]?.resolve({ items: [APP, other, MAIN] });
    });
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    selectRow('app');
    fireEvent.click(action('Delete'));
    await confirmDelete();
    await waitFor(() => {
      expect(reads).toHaveLength(2);
    });
    await screen.findByText('Deleted route table app');
    selectRow('api');
    fireEvent.click(action('Delete'));
    await confirmDelete();
    await waitFor(() => {
      expect(reads).toHaveLength(3);
    });
    act(() => {
      reads[2]?.resolve({ items: [MAIN] });
    });
    await expectRows([MAIN_ROW]);
    act(() => {
      reads[1]?.resolve({ items: [other, MAIN] });
    });
    await settled();
    expect(rows()).toEqual([MAIN_ROW]);
    expect(screen.getByText('Deleted route table api')).toBeInTheDocument();
  });
});
