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
import * as api from '../api';
import * as clusterApi from '../cluster-api';

// S6 rendered inside the area's layout, with the calls of `cluster-api.ts` answered by the case
// (`cluster-api.test.ts` proves the calls against a fake engine).

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, listInstances: vi.fn(), getInstance: vi.fn(), actOnInstance: vi.fn() };
});

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
// A DB cluster and readers.

const CREATED = new Date('2026-11-20T01:02:03.000Z');

const FULL: clusterApi.DbCluster = {
  id: 'app-aur',
  status: 'available',
  engine: 'aurora-postgresql',
  engineVersion: '16.4',
  port: 5432,
  createdAt: CREATED,
  endpoint: 'app-aur.cluster-x.us-east-1.rds.amazonaws.com',
  readerEndpoint: 'app-aur.cluster-ro-x.us-east-1.rds.amazonaws.com',
  masterUsername: 'admin1',
  databaseName: 'aurdb',
  arn: 'arn:aws:rds:us-east-1:000000000000:cluster:app-aur',
  resourceId: 'cluster-ABC',
  subnetGroup: 'default',
  securityGroups: ['sg-1', 'sg-2'],
  parameterGroup: 'default.aurora-postgresql16',
  members: [],
  deletionProtection: false,
  tags: [{ key: 'env', value: 'dev' }],
};

function found(changes: Partial<clusterApi.DbCluster> = {}): clusterApi.ClusterRead {
  return { found: true, cluster: { ...FULL, ...changes } };
}

function member(id: string, changes: Partial<api.DbInstance> = {}): api.DbInstance {
  return {
    id,
    status: 'available',
    engine: 'aurora-postgresql',
    instanceClass: 'db.r6g.large',
    clusterId: 'app-aur',
    port: 5432,
    parameterGroups: [],
    securityGroups: [],
    deletionProtection: false,
    tags: [],
    ...changes,
  };
}

const PAGE = createWrapper(document.body);
const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The key-value pairs of the section headed `section` (every group of its container) as label → value. */
function pairsOf(section: string): Record<string, string> {
  const container = PAGE.findAllContainers().find((item) =>
    text(item.findHeader()?.getElement() as Element).startsWith(section),
  );
  expect(container, section).toBeDefined();
  const groups = container === undefined ? [] : createWrapper(container.getElement()).findAllKeyValuePairs();
  expect(groups.length, section).toBeGreaterThan(0);
  const result: Record<string, string> = {};
  for (const group of groups) {
    for (const item of group.findItems()) {
      result[text(item.findLabel()?.getElement() as Element)] = text(item.findValue()?.getElement() as Element);
    }
  }
  return result;
}

/** The table of the section headed `heading`. */
function tableOf(heading: string) {
  const found = PAGE.findAllTables().find((table) =>
    text(table.findHeaderSlot()?.getElement() as Element).includes(heading),
  );
  expect(found, heading).toBeDefined();
  return found as NonNullable<typeof found>;
}

function memberRows(): string[][] {
  return (tableOf('DB instances').findRows() ?? []).map((row) =>
    [...row.getElement().querySelectorAll('td, th')].map(text),
  );
}

function control(name: string): HTMLElement {
  return screen
    .getAllByRole('button', { name })
    .find((element) => element.closest('[role="dialog"]') === null && element.closest('table') === null) as HTMLElement;
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

const PATH = '/aws/rds/clusters/cluster/app-aur';

async function loaded() {
  await screen.findByText('DB cluster details');
}

function answer(read: clusterApi.ClusterRead, members: api.DbInstance[] = []) {
  vi.mocked(clusterApi.getCluster).mockResolvedValue(read);
  vi.mocked(clusterApi.listMembers).mockResolvedValue(members);
}

/** S4's list, for a case that leads there. */
function answerList() {
  vi.mocked(clusterApi.listClusters).mockResolvedValue({ clusters: [] });
}

// ---------------------------------------------------------------------------------------------------------------

describe('a DB cluster', () => {
  it('a cluster with every value → its heading, "Connection" first, the details with their labels, the copy controls, "Tags"', async () => {
    answer(found());
    open(PATH);
    await loaded();
    expect(text(PAGE.findContentLayout()?.findHeader()?.getElement() as Element)).toContain('app-aur');
    expect(screen.getByText(/The endpoint and the sign-in values as the emulator reports them\./)).toBeInTheDocument();
    expect(pairsOf('Connection')).toEqual({
      'Writer endpoint': 'app-aur.cluster-x.us-east-1.rds.amazonaws.com',
      'Reader endpoint': 'app-aur.cluster-ro-x.us-east-1.rds.amazonaws.com',
      Port: '5432',
      'Master user name': 'admin1',
      'Database name': 'aurdb',
    });
    for (const label of [
      'Writer endpoint',
      'Reader endpoint',
      'Port',
      'Master user name',
      'Database name',
      'ARN',
      'Resource ID',
    ]) {
      expect(screen.getByRole('button', { name: `Copy ${label}` })).toBeInTheDocument();
    }
    expect(pairsOf('DB cluster details')).toEqual({
      'DB cluster identifier': 'app-aur',
      Status: 'available',
      Engine: 'aurora-postgresql 16.4',
      Created: creationDateText(CREATED),
      ARN: 'arn:aws:rds:us-east-1:000000000000:cluster:app-aur',
      'Resource ID': 'cluster-ABC',
      'DB subnet group': 'default',
      'Security groups': 'sg-1sg-2',
      'Cluster parameter group': 'default.aurora-postgresql16',
      'Deletion protection': 'Off',
    });
    // The ARN and the resource ID in a group of their own, as wide as the section.
    const identifiers = PAGE.findAllKeyValuePairs().find((pairs) =>
      [pairs.getElement(), ...pairs.getElement().querySelectorAll('[aria-label]')].some(
        (element) => element.getAttribute('aria-label') === 'DB cluster identifiers',
      ),
    );
    expect((identifiers?.findItems() ?? []).map((item) => text(item.findLabel()?.getElement() as Element))).toEqual([
      'ARN',
      'Resource ID',
    ]);
    const headings = screen.getAllByRole('heading', { level: 2 }).map(text);
    expect(headings.indexOf('Connection')).toBeLessThan(headings.indexOf('DB cluster details'));
    const tags = tableOf('Tags');
    expect((tags.findRows() ?? []).map((row) => text(row.getElement()))).toEqual(['envdev']);
  });

  it('without a database name or master user name → "-" for each, with no copy control', async () => {
    const bare: clusterApi.DbCluster = { ...FULL };
    delete bare.databaseName;
    delete bare.masterUsername;
    answer({ found: true, cluster: bare });
    open(PATH);
    await loaded();
    expect(pairsOf('Connection')['Master user name']).toBe('-');
    expect(pairsOf('Connection')['Database name']).toBe('-');
    expect(screen.queryByRole('button', { name: 'Copy Master user name' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy Database name' })).toBeNull();
  });

  it('members → a row each with its identifier (to its page), role, status, class and port', async () => {
    answer(
      found({
        members: [
          { id: 'app-aur-1', writer: true },
          { id: 'app-aur-2', writer: false },
        ],
      }),
      [member('app-aur-1'), member('app-aur-2', { status: 'creating', port: 5433 }), member('app-aur-3')],
    );
    const router = open(PATH);
    await loaded();
    await waitFor(() => {
      expect(memberRows()).toEqual([
        ['app-aur-1', 'Writer', 'available', 'db.r6g.large', '5432'],
        ['app-aur-2', 'Reader', 'creating', 'db.r6g.large', '5433'],
        ['app-aur-3', '-', 'available', 'db.r6g.large', '5432'],
      ]);
    });
    expect((tableOf('DB instances').findColumnHeaders() ?? []).map((header) => text(header.getElement()))).toEqual([
      'DB identifier',
      'Role',
      'Status',
      'Class',
      'Port',
    ]);
    const link = screen.getByRole('link', { name: 'app-aur-1' });
    expect(link).toHaveAttribute('href', '/aws/rds/instances/instance/app-aur-1');
    vi.mocked(api.getInstance).mockResolvedValue({ found: false });
    fireEvent.click(link);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/rds/instances/instance/app-aur-1');
    });
  });

  it('no member → "No DB instances" with "Add DB instance"; the section\'s own "Add DB instance" leads there too', async () => {
    answer(found());
    const router = open(PATH);
    await loaded();
    await screen.findByText('No DB instances');
    expect(screen.getByText('This cluster has no DB instance.')).toBeInTheDocument();
    const slot = tableOf('DB instances').findEmptySlot()?.getElement() as HTMLElement;
    expect(within(slot).getByRole('link', { name: 'Add DB instance' })).toHaveAttribute(
      'href',
      '/aws/rds/clusters/cluster/app-aur/add-instance',
    );
    const header = tableOf('DB instances').findHeaderSlot()?.getElement() as HTMLElement;
    const add = within(header).getByRole('link', { name: 'Add DB instance' });
    expect(add).toHaveAttribute('href', '/aws/rds/clusters/cluster/app-aur/add-instance');
    fireEvent.click(add);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/rds/clusters/cluster/app-aur/add-instance');
    });
  });

  it('a failed read of the members → "The DB instances could not be loaded" with "Retry" in that section alone', async () => {
    vi.mocked(clusterApi.getCluster).mockResolvedValue(found({ members: [{ id: 'app-aur-1', writer: true }] }));
    vi.mocked(clusterApi.listMembers).mockRejectedValue(
      new RequestError({ kind: 'other', operation: 'DescribeDBInstances', code: 'InternalFailure', message: 'broke' }),
    );
    open(PATH);
    await loaded();
    const slot = () => tableOf('DB instances').findEmptySlot()?.getElement() as HTMLElement;
    await waitFor(() => {
      expect(text(slot())).toMatch(/The DB instances could not be loaded.*InternalFailure.*broke/);
    });
    expect(pairsOf('Connection')['Port']).toBe('5432');
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    vi.mocked(clusterApi.listMembers).mockResolvedValue([member('app-aur-1')]);
    fireEvent.click(within(slot()).getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(memberRows()).toEqual([['app-aur-1', 'Writer', 'available', 'db.r6g.large', '5432']]);
    });
    expect(screen.getByText('DB cluster details')).toBeInTheDocument();
  });

  it('deletion protection "On" → "Changed with ModifyDBCluster."; "Delete" unavailable with its reason for each', async () => {
    answer(found({ deletionProtection: true }));
    open(PATH);
    await loaded();
    expect(pairsOf('DB cluster details')['Deletion protection']).toBe('OnChanged with ModifyDBCluster.');
    expect(isDisabled(control('Delete'))).toBe(true);
    expect(reasonOf(control('Delete'))).toBe('Deletion protection is on.');
    expect(screen.queryByText('Select one DB cluster.')).toBeNull();
  });

  for (const [changes, reason] of [
    [{ members: [{ id: 'm', writer: true }] }, "Delete the cluster's DB instances first, each from its own page."],
    [{ status: 'deleting' }, 'This DB cluster is already being deleted.'],
  ] as const) {
    it(`"Delete" unavailable: ${reason}`, async () => {
      answer(found(changes as Partial<clusterApi.DbCluster>));
      open(PATH);
      await loaded();
      expect(isDisabled(control('Delete'))).toBe(true);
      expect(reasonOf(control('Delete'))).toBe(reason);
    });
  }

  it('DBClusterNotFoundFault → "DB cluster not found" with "View DB clusters", and no section or action', async () => {
    answer({ found: false });
    const router = open(PATH);
    await screen.findByText('DB cluster not found');
    expect(screen.getByText('The emulator holds no DB cluster with this identifier.')).toBeInTheDocument();
    expect(screen.queryByText('Connection')).toBeNull();
    expect(screen.queryByText('DB instances', { selector: 'h2 *' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    answerList();
    fireEvent.click(screen.getByRole('link', { name: 'View DB clusters' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/rds/clusters');
    });
  });

  it('loading → "Loading DB cluster"', async () => {
    vi.mocked(clusterApi.getCluster).mockImplementation(() => new Promise(() => undefined));
    vi.mocked(clusterApi.listMembers).mockImplementation(() => new Promise(() => undefined));
    open(PATH);
    expect(await screen.findByText('Loading DB cluster')).toBeInTheDocument();
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
      vi.mocked(clusterApi.getCluster).mockRejectedValue(new RequestError(failure));
      vi.mocked(clusterApi.listMembers).mockResolvedValue([]);
      open(PATH);
      await waitFor(() => {
        expect(text(PAGE.findContentLayout()?.getElement() as Element)).toMatch(shown);
      });
      vi.mocked(clusterApi.getCluster).mockResolvedValue(found());
      const calls = vi.mocked(clusterApi.getCluster).mock.calls.length;
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await loaded();
      expect(vi.mocked(clusterApi.getCluster).mock.calls.length).toBe(calls + 1);
    });
  }

  it('"Refresh" reads the cluster and its members again', async () => {
    answer(found());
    open(PATH);
    await loaded();
    const [reads, members] = [
      vi.mocked(clusterApi.getCluster).mock.calls.length,
      vi.mocked(clusterApi.listMembers).mock.calls.length,
    ];
    answer(found({ deletionProtection: true }), []);
    fireEvent.click(control('Refresh'));
    await waitFor(() => {
      expect(pairsOf('DB cluster details')['Deletion protection']).toBe('OnChanged with ModifyDBCluster.');
    });
    expect(vi.mocked(clusterApi.getCluster).mock.calls.length).toBe(reads + 1);
    expect(vi.mocked(clusterApi.listMembers).mock.calls.length).toBe(members + 1);
  });

  it('"Delete" confirmed and answered → the clusters list with "Deleting DB cluster {id}"', async () => {
    answer(found());
    vi.mocked(clusterApi.deleteCluster).mockResolvedValue(undefined);
    answerList();
    const router = open(PATH);
    await loaded();
    fireEvent.click(control('Delete'));
    const dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('Delete DB cluster?');
    expect(text(dialog)).toContain('app-aur is deleted from the local emulator with no final snapshot.');
    await confirmDelete();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/rds/clusters');
    });
    await waitFor(() => {
      expect(flashes('success')).toEqual(['Deleting DB cluster app-aur']);
    });
    expect(vi.mocked(clusterApi.deleteCluster).mock.calls[0]?.[1]).toBe('app-aur');
  });

  it('a refusal of "Delete" → the failure in the flash, the dialog closed, the page as it was', async () => {
    answer(found());
    vi.mocked(clusterApi.deleteCluster).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'DeleteDBCluster',
        code: 'InvalidDBClusterStateFault',
        message: 'Cluster cannot be deleted, it still contains DB instances in non-deleting state.',
      }),
    );
    const router = open(PATH);
    await loaded();
    fireEvent.click(control('Delete'));
    await confirmDelete();
    await waitFor(() => {
      expect(flashes('error')).toHaveLength(1);
    });
    expect(flashes('error')[0]).toContain('InvalidDBClusterStateFault');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(router.state.location.pathname).toBe(PATH);
    expect(screen.getByText('DB cluster details')).toBeInTheDocument();
  });

  for (const order of ['before', 'after'] as const) {
    it(`after a delete, the read answering "not found" ${order} the delete's answer → the list opens with the result`, async () => {
      const reads: { resolve: (read: clusterApi.ClusterRead) => void }[] = [];
      vi.mocked(clusterApi.getCluster).mockImplementation(
        () =>
          new Promise((resolve) => {
            reads.push({ resolve });
          }),
      );
      vi.mocked(clusterApi.listMembers).mockResolvedValue([]);
      let settle: (() => void) | undefined;
      vi.mocked(clusterApi.deleteCluster).mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            settle = resolve;
          }),
      );
      answerList();
      const router = open(PATH);
      await waitFor(() => {
        expect(reads).toHaveLength(1);
      });
      act(() => {
        reads[0]?.resolve(found());
      });
      await loaded();
      fireEvent.click(control('Delete'));
      await confirmDelete();
      await waitFor(() => {
        expect(clusterApi.deleteCluster).toHaveBeenCalledTimes(1);
      });
      if (order === 'before') {
        fireEvent.click(control('Refresh'));
        await waitFor(() => {
          expect(reads).toHaveLength(2);
        });
        act(() => {
          reads[1]?.resolve({ found: false });
        });
        await screen.findByText('DB cluster not found');
      }
      act(() => {
        settle?.();
      });
      if (order === 'after') {
        await waitFor(() => {
          expect(reads.length).toBeGreaterThan(1);
        });
        act(() => {
          reads[reads.length - 1]?.resolve({ found: false });
        });
      }
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/aws/rds/clusters');
      });
      await waitFor(() => {
        expect(flashes('success')).toEqual(['Deleting DB cluster app-aur']);
      });
      expect(screen.queryByText('DB cluster not found')).toBeNull();
    });
  }

  for (const first of ['the cluster', 'the members'] as const) {
    it(`the cluster's read and the members' read answering with ${first} first → each member with the newest cluster's role`, async () => {
      const reads: { resolve: (read: clusterApi.ClusterRead) => void }[] = [];
      const lists: { resolve: (members: api.DbInstance[]) => void }[] = [];
      vi.mocked(clusterApi.getCluster).mockImplementation(
        () =>
          new Promise((resolve) => {
            reads.push({ resolve });
          }),
      );
      vi.mocked(clusterApi.listMembers).mockImplementation(
        () =>
          new Promise((resolve) => {
            lists.push({ resolve });
          }),
      );
      open(PATH);
      await waitFor(() => {
        expect(reads).toHaveLength(1);
        expect(lists).toHaveLength(1);
      });
      act(() => {
        reads[0]?.resolve(found({ members: [{ id: 'app-aur-1', writer: true }] }));
        lists[0]?.resolve([member('app-aur-1')]);
      });
      await waitFor(() => {
        expect(memberRows()).toEqual([['app-aur-1', 'Writer', 'available', 'db.r6g.large', '5432']]);
      });
      fireEvent.click(control('Refresh'));
      await waitFor(() => {
        expect(reads).toHaveLength(2);
        expect(lists).toHaveLength(2);
      });
      const newest = found({
        members: [
          { id: 'app-aur-1', writer: false },
          { id: 'app-aur-2', writer: true },
        ],
      });
      const newMembers = [member('app-aur-1'), member('app-aur-2', { status: 'creating' })];
      act(() => {
        if (first === 'the cluster') {
          reads[1]?.resolve(newest);
        } else {
          lists[1]?.resolve(newMembers);
        }
      });
      act(() => {
        if (first === 'the cluster') {
          lists[1]?.resolve(newMembers);
        } else {
          reads[1]?.resolve(newest);
        }
      });
      await waitFor(() => {
        expect(memberRows()).toEqual([
          ['app-aur-1', 'Reader', 'available', 'db.r6g.large', '5432'],
          ['app-aur-2', 'Writer', 'creating', 'db.r6g.large', '5432'],
        ]);
      });
    });
  }

  it('the page names its resources "DB clusters" to the frame', async () => {
    answer(found());
    open(PATH);
    expect(await screen.findByText('These DB clusters are in your local emulator')).toBeInTheDocument();
  });
});
