import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import AwsArea from '../../../index';
import * as clusterApi from '../cluster-api';
import * as snapshots from '../cluster-snapshot-api';

// S4 rendered inside the area's layout, with the calls of `cluster-api.ts` answered by the case
// (`cluster-api.test.ts` proves the calls against a fake engine).

vi.mock('../cluster-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../cluster-api')>();
  return {
    ...real,
    listClusters: vi.fn(),
    getCluster: vi.fn(),
    listMembers: vi.fn(),
    deleteCluster: vi.fn(),
    addInstance: vi.fn(),
  };
});

vi.mock('../cluster-snapshot-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../cluster-snapshot-api')>();
  return { ...real, listClusterSnapshots: vi.fn() };
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

const EMULATOR = { port: 9573, endpoint: 'https://127.0.0.1:9573' };
const connectedResult = (): CheckResult => ({ kind: 'connected', checkedAt: Date.now(), emulator: EMULATOR });
const notStartedResult = (): CheckResult => ({
  kind: 'emulator-unreachable',
  checkedAt: Date.now(),
  emulator: EMULATOR,
  reason: 'not_started',
  message: '',
});

let connection: Connection;
const ENGINE = 'http://127.0.0.1:8573';

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

function open(path = '/aws/rds') {
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
// DB clusters and readers.

const CREATED = new Date('2026-11-20T01:02:03.000Z');
const created = creationDateText(CREATED);

function cluster(id: string, status: string, changes: Partial<clusterApi.DbCluster> = {}): clusterApi.DbCluster {
  return {
    id,
    status,
    engine: 'aurora-postgresql',
    engineVersion: '16.4',
    port: 5432,
    createdAt: CREATED,
    securityGroups: [],
    members: [],
    deletionProtection: false,
    tags: [],
    ...changes,
  };
}

/** `listClusters` answering each request from `pages`, by its marker (`''` for none). */
function answer(pages: Record<string, clusterApi.ClusterPage>) {
  vi.mocked(clusterApi.listClusters).mockImplementation((_endpoint, marker) =>
    Promise.resolve(pages[marker ?? ''] ?? { clusters: [] }),
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

/** A control of the table's header (outside any dialog). */
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

function flashes(type?: 'success' | 'error' | 'info'): string[] {
  const bar = PAGE.findFlashbar();
  const items = bar === null ? [] : type === undefined ? bar.findItems() : bar.findItemsByType(type);
  return items.map((item) => text(item.getElement()));
}

async function confirmDelete() {
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'delete' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
}

const ROW_1 = ['app-aur', 'available', 'aurora-postgresql 16.4', '0', '5432', created];

// ---------------------------------------------------------------------------------------------------------------

describe('the DB clusters list', () => {
  it("a row per cluster with its values; the identifier links to the cluster's page", async () => {
    answer({
      '': {
        clusters: [
          cluster('app-aur', 'available'),
          cluster('my-aur', 'creating', {
            engine: 'aurora-mysql',
            engineVersion: '8.0.mysql_aurora.3.08.0',
            port: 3306,
            members: [
              { id: 'my-aur-1', writer: true },
              { id: 'my-aur-2', writer: false },
            ],
          }),
          { id: 'bare', status: 'available', securityGroups: [], members: [], deletionProtection: false, tags: [] },
        ],
      },
    });
    const router = open('/aws/rds/clusters');
    await expectRows([
      ROW_1,
      ['my-aur', 'creating', 'aurora-mysql 8.0.mysql_aurora.3.08.0', '2', '3306', created],
      ['bare', 'available', '-', '0', '-', '-'],
    ]);
    expect((table().findColumnHeaders() ?? []).map((header) => text(header.getElement())).slice(1)).toEqual([
      'DB cluster identifier',
      'Status',
      'Engine',
      'DB instances',
      'Port',
      'Created',
    ]);
    const link = screen.getByRole('link', { name: 'app-aur' });
    expect(link).toHaveAttribute('href', '/aws/rds/clusters/cluster/app-aur');
    vi.mocked(clusterApi.getCluster).mockResolvedValue({ found: false });
    vi.mocked(clusterApi.listMembers).mockResolvedValue([]);
    fireEvent.click(link);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/rds/clusters/cluster/app-aur');
    });
  });

  it('none → "No DB clusters" with "Create DB cluster", which leads to the create address', async () => {
    answer({});
    const router = open('/aws/rds/clusters');
    await waitFor(() => {
      expect(screen.getByText('No DB clusters')).toBeInTheDocument();
    });
    expect(screen.getByText('The emulator holds no DB cluster yet.')).toBeInTheDocument();
    const slot = table().findEmptySlot()?.getElement() as HTMLElement;
    fireEvent.click(within(slot).getByRole('link', { name: 'Create DB cluster' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/rds/clusters/create');
    });
  });

  it('loading → "Loading DB clusters"', async () => {
    vi.mocked(clusterApi.listClusters).mockImplementation(() => new Promise(() => undefined));
    open('/aws/rds/clusters');
    await waitFor(() => {
      expect(screen.getByText('Loading DB clusters')).toBeInTheDocument();
    });
  });

  const failures: [string, RequestFailure, RegExp, boolean?][] = [
    [
      'not implemented',
      { kind: 'not-implemented', operation: 'DescribeDBClusters' },
      /Not implemented by the emulator.*DescribeDBClusters/,
    ],
    ['access denied', { kind: 'access-denied', operation: 'DescribeDBClusters', message: 'no' }, /Access denied/],
    [
      'the emulator not answering',
      { kind: 'emulator-did-not-answer', operation: 'DescribeDBClusters', message: 'timed out' },
      /The emulator did not answer/,
    ],
    [
      'the engine not answering',
      { kind: 'engine-did-not-answer', operation: 'DescribeDBClusters' },
      /engine.*did not answer/,
    ],
    [
      'another code and message',
      { kind: 'other', operation: 'DescribeDBClusters', code: 'InternalFailure', message: 'broke' },
      /InternalFailure.*broke/,
    ],
    ['not connected', { kind: 'other', operation: 'DescribeDBClusters', code: 'X' }, /Not started on port/, true],
  ];
  for (const [kind, failure, shown, down] of failures) {
    it(`a failed read, ${kind} → its state with "Retry", which reads again`, async () => {
      if (down === true) {
        connection.value = { result: notStartedResult(), engineOrigin: ENGINE };
      }
      vi.mocked(clusterApi.listClusters).mockRejectedValue(new RequestError(failure));
      open('/aws/rds/clusters');
      const slot = () => table().findEmptySlot()?.getElement() as HTMLElement;
      await waitFor(() => {
        expect(slot().textContent).toMatch(shown);
      });
      const calls = vi.mocked(clusterApi.listClusters).mock.calls.length;
      answer({ '': { clusters: [cluster('app-aur', 'available')] } });
      fireEvent.click(within(slot()).getByRole('button', { name: 'Retry' }));
      await expectRows([ROW_1]);
      expect(vi.mocked(clusterApi.listClusters).mock.calls.length).toBe(calls + 1);
    });
  }

  it('the next page asks with the marker; "previous" shows the page before', async () => {
    answer({
      '': { clusters: [cluster('app-aur', 'available')], marker: 'm-2' },
      'm-2': { clusters: [cluster('zz-aur', 'available')] },
    });
    open('/aws/rds/clusters');
    await expectRows([ROW_1]);
    expect(vi.mocked(clusterApi.listClusters).mock.calls.at(-1)?.[1]).toBeUndefined();
    fireEvent.click(table().findPagination()?.findNextPageButton().getElement() as HTMLElement);
    await waitFor(() => {
      expect(rows()[0]?.[0]).toBe('zz-aur');
    });
    expect(vi.mocked(clusterApi.listClusters).mock.calls.at(-1)?.[1]).toBe('m-2');
    fireEvent.click(table().findPagination()?.findPreviousPageButton().getElement() as HTMLElement);
    await expectRows([ROW_1]);
  });

  it('no row selected → "Delete" unavailable with "Select one DB cluster."; each reason of the selected cluster', async () => {
    answer({
      '': {
        clusters: [
          cluster('free', 'available'),
          cluster('with-member', 'available', { members: [{ id: 'm', writer: true }] }),
          cluster('kept', 'available', { deletionProtection: true }),
          cluster('going', 'deleting'),
        ],
      },
    });
    open('/aws/rds/clusters');
    await waitFor(() => {
      expect(rows()).toHaveLength(4);
    });
    expect(isDisabled(action('Delete'))).toBe(true);
    expect(reasonOf(action('Delete'))).toBe('Select one DB cluster.');
    for (const [id, reason] of [
      ['with-member', "Delete the cluster's DB instances first, each from its own page."],
      ['kept', 'Deletion protection is on.'],
      ['going', 'This DB cluster is already being deleted.'],
    ] as const) {
      selectRow(id);
      await waitFor(() => {
        expect(reasonOf(action('Delete'))).toBe(reason);
      });
      expect(isDisabled(action('Delete'))).toBe(true);
    }
    selectRow('free');
    await waitFor(() => {
      expect(isDisabled(action('Delete'))).toBe(false);
    });
  });

  it('"Delete" confirmed → the cluster is deleted, "Deleting DB cluster {id}" shown and the list read again', async () => {
    answer({ '': { clusters: [cluster('app-aur', 'available')] } });
    vi.mocked(clusterApi.deleteCluster).mockResolvedValue(undefined);
    const router = open('/aws/rds/clusters');
    await expectRows([ROW_1]);
    selectRow('app-aur');
    fireEvent.click(action('Delete'));
    const dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('Delete DB cluster?');
    expect(text(dialog)).toContain('app-aur is deleted from the local emulator with no final snapshot.');
    const calls = vi.mocked(clusterApi.listClusters).mock.calls.length;
    answer({ '': { clusters: [] } });
    await confirmDelete();
    await waitFor(() => {
      expect(flashes('success')).toEqual(['Deleting DB cluster app-aur']);
    });
    expect(vi.mocked(clusterApi.deleteCluster).mock.calls[0]?.[1]).toBe('app-aur');
    await waitFor(() => {
      expect(vi.mocked(clusterApi.listClusters).mock.calls.length).toBe(calls + 1);
    });
    await waitFor(() => {
      expect(screen.getByText('No DB clusters')).toBeInTheDocument();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(router.state.location.pathname).toBe('/aws/rds/clusters');
  });

  it('a refusal → the failure in the flash, the dialog closed and the row stays', async () => {
    answer({ '': { clusters: [cluster('app-aur', 'available')] } });
    vi.mocked(clusterApi.deleteCluster).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'DeleteDBCluster',
        code: 'InvalidDBClusterStateFault',
        message: 'Cluster cannot be deleted, it still contains DB instances in non-deleting state.',
      }),
    );
    open('/aws/rds/clusters');
    await expectRows([ROW_1]);
    selectRow('app-aur');
    fireEvent.click(action('Delete'));
    await confirmDelete();
    await waitFor(() => {
      expect(flashes('error')).toHaveLength(1);
    });
    expect(flashes('error')[0]).toContain('InvalidDBClusterStateFault');
    expect(flashes('error')[0]).toContain('it still contains DB instances');
    expect(screen.queryByRole('dialog')).toBeNull();
    await expectRows([ROW_1]);
  });

  it('a 501 of "Delete" → not implemented with DeleteDBCluster', async () => {
    answer({ '': { clusters: [cluster('app-aur', 'available')] } });
    vi.mocked(clusterApi.deleteCluster).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'DeleteDBCluster' }),
    );
    open('/aws/rds/clusters');
    await expectRows([ROW_1]);
    selectRow('app-aur');
    fireEvent.click(action('Delete'));
    await confirmDelete();
    await waitFor(() => {
      expect(flashes().join(' ')).toMatch(/Not implemented by the emulator.*DeleteDBCluster/);
    });
  });

  it('"Refresh" reads the page again; the page names its resources "DB clusters" to the frame', async () => {
    answer({ '': { clusters: [cluster('app-aur', 'available')] } });
    open('/aws/rds/clusters');
    await expectRows([ROW_1]);
    expect(screen.getByText('These DB clusters are in your local emulator')).toBeInTheDocument();
    const calls = vi.mocked(clusterApi.listClusters).mock.calls.length;
    answer({ '': { clusters: [cluster('app-aur', 'available', { port: 6000 })] } });
    fireEvent.click(action('Refresh'));
    await waitFor(() => {
      expect(rows()[0]?.[4]).toBe('6000');
    });
    expect(vi.mocked(clusterApi.listClusters).mock.calls.length).toBe(calls + 1);
  });

  it('after a delete, the reads that follow answering the later one first → the newest shown, the result still shown', async () => {
    const reads: { resolve: (page: clusterApi.ClusterPage) => void }[] = [];
    vi.mocked(clusterApi.listClusters).mockImplementation(
      () =>
        new Promise((resolve) => {
          reads.push({ resolve });
        }),
    );
    vi.mocked(clusterApi.deleteCluster).mockResolvedValue(undefined);
    open('/aws/rds/clusters');
    await waitFor(() => {
      expect(reads).toHaveLength(1);
    });
    act(() => {
      reads[0]?.resolve({ clusters: [cluster('app-aur', 'available'), cluster('other', 'available')] });
    });
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    selectRow('app-aur');
    fireEvent.click(action('Delete'));
    await confirmDelete();
    await waitFor(() => {
      expect(reads).toHaveLength(2);
    });
    await waitFor(() => {
      expect(flashes('success')).toEqual(['Deleting DB cluster app-aur']);
    });
    fireEvent.click(action('Refresh'));
    await waitFor(() => {
      expect(reads).toHaveLength(3);
    });
    act(() => {
      reads[2]?.resolve({ clusters: [cluster('other', 'available')] });
    });
    await waitFor(() => {
      expect(rows()).toEqual([['other', 'available', 'aurora-postgresql 16.4', '0', '5432', created]]);
    });
    act(() => {
      reads[1]?.resolve({ clusters: [cluster('app-aur', 'deleting'), cluster('other', 'available')] });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(rows()).toHaveLength(1);
    expect(flashes('success')).toEqual(['Deleting DB cluster app-aur']);
  });
});

it('links to manual DB cluster snapshots even when there are no clusters', async () => {
  vi.mocked(clusterApi.listClusters).mockResolvedValue({ clusters: [] });
  vi.mocked(snapshots.listClusterSnapshots).mockResolvedValue({ items: [] });
  const router = open('/aws/rds/clusters');
  await waitFor(() => {
    expect(table().findEmptySlot()?.getElement()).toHaveTextContent('No DB clusters');
  });
  fireEvent.click(within(table().getElement()).getByRole('link', { name: 'DB cluster snapshots' }));
  await waitFor(() => {
    const heading = table().findHeaderSlot()?.findHeader()?.findHeadingText().getElement();
    expect(heading).toHaveTextContent('DB cluster snapshots');
  });
  expect(router.state.location.pathname).toBe('/aws/rds/cluster-snapshots');
});
