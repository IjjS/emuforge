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
import type { ClusterAction } from '../cluster-operations';

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
    operateCluster: vi.fn(),
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
  backupRetentionPeriod: 7,
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
      'Backup retention period (days)': '7',
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

  it.each(['aurora-postgresql', 'aurora-mysql'])('uses the described port of an %s cluster', async (engine) => {
    answer(found({ engine, port: 28304 }), [member('app-aur-1', { engine, port: 28305 })]);
    open(PATH);
    await loaded();

    expect(pairsOf('Connection')['Port']).toBe('28304');
    expect(
      screen.getByText((_, element) => element?.textContent === '127.0.0.1:28304', {
        selector: '.aws-area-value-address',
      }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Copy Compose host endpoint' })).toBeInTheDocument();
  });

  it('keeps the reported cluster endpoints when no port is reported', async () => {
    const cluster = { ...FULL };
    delete cluster.port;
    answer({ found: true, cluster });
    open(PATH);
    await loaded();

    expect(pairsOf('Connection')['Writer endpoint']).toBe(FULL.endpoint);
    expect(pairsOf('Connection')['Reader endpoint']).toBe(FULL.readerEndpoint);
    expect(pairsOf('Connection')['Port']).toBe('-');
    expect(screen.queryByRole('button', { name: 'Copy Port' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy Compose host endpoint' })).toBeNull();
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

function openActions() {
  fireEvent.click(control('Actions'));
  const menu = PAGE.findButtonDropdown();
  if (menu === null) throw new Error('Missing cluster Actions dropdown.');
  return menu;
}

function chooseAction(action: ClusterAction) {
  const item = openActions().findItemById(action, { disabled: false });
  expect(item).not.toBeNull();
  if (item === null) throw new Error(`Unavailable cluster action: ${action}`);
  fireEvent.click(item.getElement());
}

async function editCluster() {
  chooseAction('modify');
  return within(await screen.findByRole('dialog', { name: 'Modify DB cluster' }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function holdRound() {
  const cluster = deferred<clusterApi.ClusterRead>();
  const members = deferred<api.DbInstance[]>();
  vi.mocked(clusterApi.getCluster).mockReturnValueOnce(cluster.promise);
  vi.mocked(clusterApi.listMembers).mockReturnValueOnce(members.promise);
  return { cluster, members };
}

const ROLES = [
  { id: 'app-aur-1', writer: true },
  { id: 'app-aur-2', writer: false },
  { id: 'app-aur-3', writer: false },
];

function rowsAt(status = 'available') {
  return ROLES.map(({ id }) => member(id, { status }));
}

async function editFailover() {
  chooseAction('failover');
  const dialog = await screen.findByRole('dialog', { name: 'Fail over DB cluster' });
  const picker = createWrapper(dialog).findSelect();
  if (picker === null) throw new Error('Missing failover reader picker.');
  return { picker, submit: within(dialog).getByRole('button', { name: 'Fail over' }) };
}

async function selectReader(target: string) {
  const { picker, submit } = await editFailover();
  picker.openDropdown();
  await waitFor(() => {
    const options = picker.findDropdown().findOptions();
    expect(options.map((option) => text(option.findLabel().getElement()))).toEqual(['app-aur-2', 'app-aur-3']);
  });
  picker.selectOptionByValue(target);
  return submit;
}

function rejectOperation(operation: string, message: string) {
  vi.mocked(clusterApi.operateCluster).mockRejectedValueOnce(
    new RequestError({ kind: 'other', operation, code: 'InvalidDBClusterStateFault', message }),
  );
}

async function expectRefusal(message: string) {
  await waitFor(() => {
    expect(flashes('error')[0]).toContain('app-aur');
    expect(flashes('error')[0]).toContain('InvalidDBClusterStateFault');
    expect(flashes('error')[0]).toContain(message);
  });
  expect(flashes('success')).toEqual([]);
}

describe('Aurora cluster operations', () => {
  beforeEach(() => {
    vi.mocked(clusterApi.operateCluster).mockReset().mockResolvedValue(undefined);
  });

  it('offers Stop when available, Start when stopped and neither during a transition', async () => {
    answer(found());
    open(PATH);
    await loaded();
    for (const [status, stopDisabled, startDisabled] of [
      ['available', false, true],
      ['stopped', true, false],
      ['stopping', true, true],
    ] as const) {
      if (status !== 'available') {
        answer(found({ status }));
        fireEvent.click(control('Refresh'));
        await loaded();
      }
      const menu = openActions();
      expect(menu.findItemById('stop', { disabled: stopDisabled })).not.toBeNull();
      expect(menu.findItemById('start', { disabled: startDisabled })).not.toBeNull();
      fireEvent.click(control('Actions'));
    }
  });

  // Bound: Allow the real three-second poll and the separately settled cluster and member responses.
  it.each([
    ['stop', 'available', 'stopping', 'stopped', 'Stopping'],
    ['start', 'stopped', 'starting', 'available', 'Starting'],
  ] as const)(
    'polls the cluster and members together after %s is accepted',
    async (action, before, moving, final, verb) => {
      answer(found({ status: before, members: ROLES }), rowsAt(before));
      open(PATH);
      await loaded();

      answer(found({ status: moving, members: ROLES }), rowsAt(moving));
      chooseAction(action);
      await screen.findByText(`${verb} DB cluster app-aur`);
      await waitFor(() => expect(pairsOf('DB cluster details')['Status']).toBe(moving));
      expect(clusterApi.operateCluster).toHaveBeenCalledWith(
        ENGINE,
        'app-aur',
        { kind: action },
        expect.any(AbortSignal),
      );

      const next = holdRound();
      await waitFor(() => expect(clusterApi.listMembers).toHaveBeenCalledTimes(3), { timeout: 4_000 });
      await act(async () => next.cluster.resolve(found({ status: final, members: ROLES })));
      expect(pairsOf('DB cluster details')['Status']).toBe(moving);
      await act(async () => next.members.resolve(rowsAt(final)));
      await waitFor(() => {
        expect(pairsOf('DB cluster details')['Status']).toBe(final);
        expect(memberRows().map((row) => row.slice(0, 3))).toEqual(
          ROLES.map(({ id, writer }) => [id, writer ? 'Writer' : 'Reader', final]),
        );
      });
      expect(flashes('success')).toEqual([`${verb} DB cluster app-aur`]);
    },
    8_000,
  );

  it.each([
    ['stop', 'available', 'StopDBCluster'],
    ['start', 'stopped', 'StartDBCluster'],
  ] as const)('shows the service error when %s is refused after a state change', async (action, status, operation) => {
    answer(found({ status }));
    rejectOperation(operation, 'The DB cluster changed state.');
    open(PATH);
    await loaded();
    chooseAction(action);
    await expectRefusal('The DB cluster changed state.');
  });

  it('prefills Modify, sends only changed protection, and retains the result after both reads', async () => {
    answer(found({ deletionProtection: true, members: ROLES }), rowsAt());
    open(PATH);
    await loaded();
    const dialog = await editCluster();
    const protection = dialog.getByRole('checkbox', { name: 'Deletion protection' });
    expect(protection).toBeChecked();
    expect(dialog.getByRole('textbox', { name: 'Backup retention period (days)' })).toHaveValue('7');

    const next = holdRound();
    fireEvent.click(protection);
    fireEvent.click(dialog.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('DB cluster app-aur updated');
    expect(clusterApi.operateCluster).toHaveBeenCalledWith(
      ENGINE,
      'app-aur',
      { kind: 'modify', changes: { deletionProtection: false } },
      expect.any(AbortSignal),
    );
    await waitFor(() => expect(clusterApi.listMembers).toHaveBeenCalledTimes(2));
    await act(async () => next.cluster.resolve(found({ members: ROLES })));
    expect(pairsOf('DB cluster details')['Deletion protection']).toBe('OnChanged with ModifyDBCluster.');
    await act(async () => next.members.resolve(rowsAt()));
    await waitFor(() => {
      expect(pairsOf('DB cluster details')['Deletion protection']).toBe('Off');
      expect(memberRows().map(([id]) => id)).toEqual(ROLES.map(({ id }) => id));
    });
    expect(reasonOf(control('Delete'))).toBe("Delete the cluster's DB instances first, each from its own page.");
    expect(flashes('success')).toEqual(['DB cluster app-aur updated']);
  });

  it('sends only the new retention period and displays the value returned by the read', async () => {
    answer(found({ deletionProtection: true }));
    open(PATH);
    await loaded();
    const dialog = await editCluster();
    answer(found({ deletionProtection: true, backupRetentionPeriod: 35 }));
    fireEvent.change(dialog.getByRole('textbox', { name: 'Backup retention period (days)' }), {
      target: { value: '35' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Save changes' }));

    expect(clusterApi.operateCluster).toHaveBeenCalledWith(
      ENGINE,
      'app-aur',
      { kind: 'modify', changes: { backupRetentionPeriod: 35 } },
      expect.any(AbortSignal),
    );
    await waitFor(() => expect(pairsOf('DB cluster details')['Backup retention period (days)']).toBe('35'));
    expect(pairsOf('DB cluster details')['Deletion protection']).toBe('OnChanged with ModifyDBCluster.');
  });

  it('blocks empty, fractional and out-of-range retention periods and accepts 1 and 35', async () => {
    answer(found());
    open(PATH);
    await loaded();
    const dialog = await editCluster();
    const retention = dialog.getByRole('textbox', { name: 'Backup retention period (days)' });
    const save = dialog.getByRole('button', { name: 'Save changes' });
    for (const value of ['', '1.5', '0', '36']) {
      fireEvent.change(retention, { target: { value } });
      expect(dialog.getByText('Enter a whole number from 1 to 35.')).toBeVisible();
      expect(save).toBeDisabled();
      fireEvent.click(save);
    }
    expect(clusterApi.operateCluster).not.toHaveBeenCalled();

    for (const value of ['1', '35']) {
      fireEvent.change(retention, { target: { value } });
      expect(dialog.queryByText('Enter a whole number from 1 to 35.')).toBeNull();
      expect(save).toBeEnabled();
    }
  });

  it('shows a refused Modify on the page and prefills the draft when reopened', async () => {
    answer(found({ deletionProtection: true }));
    rejectOperation('ModifyDBCluster', 'The cluster cannot be modified now.');
    open(PATH);
    await loaded();
    const dialog = await editCluster();
    fireEvent.click(dialog.getByRole('checkbox', { name: 'Deletion protection' }));
    fireEvent.change(dialog.getByRole('textbox', { name: 'Backup retention period (days)' }), {
      target: { value: '14' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Save changes' }));
    await expectRefusal('The cluster cannot be modified now.');
    expect(pairsOf('DB cluster details')['Deletion protection']).toBe('OnChanged with ModifyDBCluster.');
    expect(pairsOf('DB cluster details')['Backup retention period (days)']).toBe('7');

    const reopened = await editCluster();
    expect(reopened.getByRole('checkbox', { name: 'Deletion protection' })).not.toBeChecked();
    const retention = reopened.getByRole('textbox', { name: 'Backup retention period (days)' });
    expect(retention).toHaveValue('14');
    fireEvent.change(retention, { target: { value: '21' } });
    answer(found({ deletionProtection: false, backupRetentionPeriod: 21 }));
    fireEvent.click(reopened.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('DB cluster app-aur updated');
    expect(clusterApi.operateCluster).toHaveBeenLastCalledWith(
      ENGINE,
      'app-aur',
      { kind: 'modify', changes: { deletionProtection: false, backupRetentionPeriod: 21 } },
      expect.any(AbortSignal),
    );
  });

  it('explains why a cluster without a reader cannot fail over', async () => {
    answer(found({ members: ROLES.filter(({ writer }) => writer) }), [member('app-aur-1')]);
    open(PATH);
    await loaded();
    const menu = openActions();
    const failover = menu.findItemById('failover', { disabled: true });
    if (failover === null) throw new Error('Missing disabled Fail over action.');
    fireEvent.mouseEnter(failover.getElement());
    await waitFor(() => {
      expect(menu.findDisabledReason()?.getElement()).toHaveTextContent(
        'Failover requires a reader DB instance in this cluster.',
      );
    });
    fireEvent.click(failover.getElement());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(clusterApi.operateCluster).not.toHaveBeenCalled();
  });

  // Bound: Allow the reader dialog, the real three-second poll, and the ordered cluster and member responses.
  it('sends the second reader as the failover target and polls until the new roles and statuses are visible', async () => {
    answer(found({ members: ROLES }), rowsAt());
    open(PATH);
    await loaded();
    const submit = await selectReader('app-aur-3');
    answer(found({ status: 'failing-over', members: ROLES }), rowsAt());
    fireEvent.click(submit);
    await screen.findByText('Failing over DB cluster app-aur');
    expect(clusterApi.operateCluster).toHaveBeenCalledWith(
      ENGINE,
      'app-aur',
      { kind: 'failover', target: 'app-aur-3' },
      expect.any(AbortSignal),
    );
    await waitFor(() => expect(pairsOf('DB cluster details')['Status']).toBe('failing-over'));

    const next = holdRound();
    await waitFor(() => expect(clusterApi.listMembers).toHaveBeenCalledTimes(3), { timeout: 4_000 });
    const promoted = ROLES.map(({ id }) => ({ id, writer: id === 'app-aur-3' }));
    await act(async () => next.cluster.resolve(found({ members: promoted })));
    expect(pairsOf('DB cluster details')['Status']).toBe('failing-over');
    await act(async () => next.members.resolve(rowsAt()));
    await waitFor(() => {
      expect(pairsOf('DB cluster details')['Status']).toBe('available');
      expect(memberRows().map((row) => row.slice(0, 3))).toEqual([
        ['app-aur-1', 'Reader', 'available'],
        ['app-aur-2', 'Reader', 'available'],
        ['app-aur-3', 'Writer', 'available'],
      ]);
    });
    expect(flashes('success')).toEqual(['Failing over DB cluster app-aur']);
  }, 8_000);

  it('shows a refused Fail over on the page and prefills the reader when reopened', async () => {
    answer(found({ members: ROLES }), rowsAt());
    rejectOperation('FailoverDBCluster', 'The selected DB instance is no longer in this cluster.');
    open(PATH);
    await loaded();
    fireEvent.click(await selectReader('app-aur-3'));
    await expectRefusal('The selected DB instance is no longer in this cluster.');

    const { picker, submit } = await editFailover();
    expect(picker.findTrigger().getElement()).toHaveTextContent('app-aur-3');
    picker.openDropdown();
    picker.selectOptionByValue('app-aur-2');
    fireEvent.click(submit);
    await screen.findByText('Failing over DB cluster app-aur');
    expect(clusterApi.operateCluster).toHaveBeenLastCalledWith(
      ENGINE,
      'app-aur',
      { kind: 'failover', target: 'app-aur-2' },
      expect.any(AbortSignal),
    );
  });

  it('keeps the Multi-AZ detail and Delete without exposing Aurora operations', async () => {
    answer(found({ engine: 'postgres', engineVersion: '16.4' }));
    open(PATH);
    await loaded();
    expect(pairsOf('DB cluster details')['Engine']).toBe('postgres 16.4');
    expect(control('Delete')).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Actions' })).toBeNull();
  });

  it.each([
    ['stop', 'available', 'StopDBCluster'],
    ['start', 'stopped', 'StartDBCluster'],
    ['modify', 'available', 'ModifyDBCluster'],
    ['failover', 'available', 'FailoverDBCluster'],
  ] as const)('keeps %s visible and disabled after a 501 response', async (action, status, operation) => {
    answer(found({ status, members: ROLES }), rowsAt());
    vi.mocked(clusterApi.operateCluster).mockRejectedValueOnce(
      new RequestError({ kind: 'not-implemented', operation }),
    );
    open(PATH);
    await loaded();
    if (action === 'modify') {
      const dialog = await editCluster();
      fireEvent.click(dialog.getByRole('checkbox', { name: 'Deletion protection' }));
      fireEvent.click(dialog.getByRole('button', { name: 'Save changes' }));
    } else if (action === 'failover') {
      fireEvent.click(await selectReader('app-aur-3'));
    } else {
      chooseAction(action);
    }

    await screen.findByText('Not implemented by the emulator');
    expect(flashes('info')[0]).toContain(operation);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(openActions().findItemById(action, { disabled: true })).not.toBeNull();
    expect(clusterApi.operateCluster).toHaveBeenCalledTimes(1);
  });
});
