import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import type { DbInstance } from '../api';
import * as clusters from '../cluster-api';
import * as snapshots from '../cluster-snapshot-api';

vi.mock('../cluster-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../cluster-api')>();
  return { ...real, getCluster: vi.fn(), listMembers: vi.fn() };
});

vi.mock('../cluster-snapshot-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../cluster-snapshot-api')>();
  return {
    ...real,
    listClusterSnapshots: vi.fn(),
    restoreClusterSnapshot: vi.fn(),
    deleteClusterSnapshot: vi.fn(),
  };
});

const PATH = '/aws/rds/cluster-snapshots';
const ENGINE = 'http://127.0.0.1:8573';
const CONNECTION: AreaConnection = {
  engineOrigin: ENGINE,
  result: {
    kind: 'connected',
    checkedAt: 0,
    emulator: { endpoint: 'https://127.0.0.1:9573', port: 9573 },
  },
};

const ORPHAN = { id: 'orphan-snap', sourceId: 'old-cluster', engine: 'aurora-postgresql', status: 'available' };
const OTHER = { id: 'other-snap', sourceId: 'other-cluster', engine: 'aurora-mysql', status: 'available' };
const CREATING = { ...OTHER, id: 'creating-snap', status: 'creating' };
const MARKER = 'c25hcC0yMA==';

function AreaWithStudioProps() {
  const { pathname } = useLocation();
  const [visit, setVisit] = useState({ pathname, count: 0 });
  if (visit.pathname !== pathname) {
    setVisit({ pathname, count: visit.count + 1 });
  }
  return (
    <AwsArea
      headerSelector="#top-bar"
      onPageTitle={() => undefined}
      onContentTarget={() => undefined}
      routeChanges={visit.count}
      connection={CONNECTION}
    />
  );
}

function open() {
  const router = createMemoryRouter([{ path: '/aws/*', element: <AreaWithStudioProps /> }], { initialEntries: [PATH] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

function action(name: string) {
  return screen.getByRole('button', { name });
}

async function select(snapshot = ORPHAN) {
  const row = await screen.findByRole('row', { name: new RegExp(snapshot.id) });
  fireEvent.click(within(row).getByRole('radio', { name: snapshot.id }));
  return row;
}

async function openRestore() {
  await select();
  fireEvent.click(action('Restore'));
  return within(await screen.findByRole('dialog', { name: 'Restore DB cluster from snapshot' }));
}

async function submitRestore(id: string) {
  const dialog = await openRestore();
  fireEvent.change(dialog.getByRole('textbox', { name: 'DB cluster identifier' }), { target: { value: id } });
  fireEvent.click(dialog.getByRole('button', { name: 'Restore' }));
}

async function openDelete() {
  await select();
  fireEvent.click(action('Delete'));
  return within(await screen.findByRole('dialog', { name: 'Delete DB cluster snapshot?' }));
}

async function submitDelete() {
  const dialog = await openDelete();
  fireEvent.change(dialog.getByRole('textbox'), { target: { value: 'delete' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Delete' }));
}

function rejected(operation: string, code: string, message: string) {
  return new RequestError({ kind: 'other', operation, code, message });
}

function unsupported(operation: string) {
  const failure: RequestFailure = { kind: 'not-implemented', operation };
  return new RequestError(failure);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.mocked(snapshots.listClusterSnapshots)
    .mockReset()
    .mockResolvedValue({ items: [ORPHAN] });
  vi.mocked(snapshots.restoreClusterSnapshot).mockReset().mockResolvedValue('restored-cluster');
  vi.mocked(snapshots.deleteClusterSnapshot).mockReset().mockResolvedValue(undefined);
  vi.mocked(clusters.getCluster).mockReset();
  vi.mocked(clusters.listMembers).mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DB cluster snapshots', () => {
  it('uses the previous response Marker to show the next page of manual snapshots', async () => {
    vi.mocked(snapshots.listClusterSnapshots).mockImplementation(async (_endpoint, marker) =>
      marker === MARKER ? { items: [ORPHAN] } : { items: [OTHER], next: MARKER },
    );
    open();

    await screen.findByRole('row', { name: /other-snap/ });
    fireEvent.click(action('Next page'));
    const row = within(await screen.findByRole('row', { name: /orphan-snap/ }));
    for (const value of [ORPHAN.id, ORPHAN.sourceId, ORPHAN.engine, ORPHAN.status]) {
      expect(row.getByText(value)).toBeInTheDocument();
    }
    expect(screen.queryByRole('row', { name: /other-snap/ })).not.toBeInTheDocument();
    expect(snapshots.listClusterSnapshots).toHaveBeenNthCalledWith(1, ENGINE, undefined, expect.any(AbortSignal));
    expect(snapshots.listClusterSnapshots).toHaveBeenNthCalledWith(2, ENGINE, MARKER, expect.any(AbortSignal));
  });

  it('shows an empty list and reloads the emulator rows when a failed read is retried', async () => {
    vi.mocked(snapshots.listClusterSnapshots)
      .mockResolvedValueOnce({ items: [] })
      .mockRejectedValueOnce(rejected('DescribeDBClusterSnapshots', 'InternalFailure', 'Snapshot read failed.'));
    open();

    expect(await screen.findByText('No DB cluster snapshots')).toBeInTheDocument();
    fireEvent.click(action('Refresh'));
    expect(await screen.findByText(/Snapshot read failed/)).toBeInTheDocument();
    fireEvent.click(action('Retry'));
    expect(await screen.findByRole('row', { name: /orphan-snap/ })).toBeInTheDocument();
  });

  it('shows the operation that is unsupported when DescribeDBClusterSnapshots returns 501', async () => {
    vi.mocked(snapshots.listClusterSnapshots).mockRejectedValueOnce(unsupported('DescribeDBClusterSnapshots'));
    open();

    expect(await screen.findAllByText('Not implemented by the emulator')).not.toHaveLength(0);
    expect(screen.getByText(/501 Not Implemented for DescribeDBClusterSnapshots/)).toBeInTheDocument();
  });

  it('restores an available orphaned snapshot and shows the complete destination read and result', async () => {
    vi.mocked(snapshots.listClusterSnapshots).mockResolvedValue({ items: [CREATING, ORPHAN] });
    const cluster = deferred<clusters.ClusterRead>();
    const members = deferred<DbInstance[]>();
    vi.mocked(clusters.getCluster).mockReturnValue(cluster.promise);
    vi.mocked(clusters.listMembers).mockReturnValue(members.promise);
    const router = open();

    await select(CREATING);
    expect(action('Restore')).toBeDisabled();
    await submitRestore('requested-cluster');

    expect(snapshots.restoreClusterSnapshot).toHaveBeenCalledWith(
      ENGINE,
      ORPHAN.id,
      ORPHAN.engine,
      'requested-cluster',
      expect.any(AbortSignal),
    );
    expect(await screen.findByText('Restoring DB cluster restored-cluster')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/aws/rds/clusters/cluster/restored-cluster');
    await waitFor(() => {
      expect(clusters.getCluster).toHaveBeenCalledWith(ENGINE, 'restored-cluster', expect.any(AbortSignal));
      expect(clusters.listMembers).toHaveBeenCalledWith(ENGINE, 'restored-cluster', expect.any(AbortSignal));
    });

    await act(async () => {
      cluster.resolve({
        found: true,
        cluster: {
          id: 'restored-cluster',
          status: 'available',
          engine: ORPHAN.engine,
          members: [],
          securityGroups: [],
          deletionProtection: false,
          tags: [],
        },
      });
      await cluster.promise;
    });
    expect(screen.queryByText('No DB instances')).not.toBeInTheDocument();
    await act(async () => {
      members.resolve([]);
      await members.promise;
    });

    expect(await screen.findByText('No DB instances')).toBeInTheDocument();
    expect(screen.getByText('available')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'restored-cluster', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Restoring DB cluster restored-cluster')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Add DB instance' })[0]).toHaveAttribute(
      'href',
      '/aws/rds/clusters/cluster/restored-cluster/add-instance',
    );
  });

  it('shows the target and service refusal for a duplicate restore identifier', async () => {
    vi.mocked(snapshots.restoreClusterSnapshot).mockRejectedValueOnce(
      rejected('RestoreDBClusterFromSnapshot', 'DBClusterAlreadyExistsFault', 'A cluster with this identifier exists.'),
    );
    const router = open();
    await submitRestore('existing-cluster');

    expect(
      await screen.findByText('Restore DB cluster existing-cluster from snapshot orphan-snap failed'),
    ).toBeInTheDocument();
    expect(screen.getByText(/A cluster with this identifier exists/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(PATH);
  });

  it('requires the exact confirmation word and leaves the snapshot when cancelled', async () => {
    open();
    const dialog = await openDelete();
    expect(dialog.getByText(/Delete orphan-snap from the local emulator/)).toBeInTheDocument();
    const confirm = dialog.getByRole('button', { name: 'Delete' });
    const input = dialog.getByRole('textbox');

    expect(confirm).toBeDisabled();
    fireEvent.change(input, { target: { value: 'Delete' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(input, { target: { value: 'delete' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('row', { name: /orphan-snap/ })).toBeInTheDocument();
    expect(snapshots.deleteClusterSnapshot).not.toHaveBeenCalled();
  });

  it('keeps the deletion result when the refreshed list has already dropped the selected row', async () => {
    let deleted = false;
    vi.mocked(snapshots.listClusterSnapshots).mockImplementation(async () => ({ items: deleted ? [] : [ORPHAN] }));
    vi.mocked(snapshots.deleteClusterSnapshot).mockImplementationOnce(async () => {
      deleted = true;
    });
    open();
    await submitDelete();

    expect(snapshots.deleteClusterSnapshot).toHaveBeenCalledWith(ENGINE, ORPHAN.id, expect.any(AbortSignal));
    expect(await screen.findByText('No DB cluster snapshots')).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /orphan-snap/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('DB cluster snapshot orphan-snap deleted')).toBeInTheDocument();
  });

  it('allows returning to the preceding page after deleting the last row on a later page', async () => {
    let deleted = false;
    vi.mocked(snapshots.listClusterSnapshots).mockImplementation(async (_endpoint, marker) =>
      marker === MARKER
        ? { items: deleted ? [] : [ORPHAN] }
        : deleted
          ? { items: [OTHER] }
          : { items: [OTHER], next: MARKER },
    );
    vi.mocked(snapshots.deleteClusterSnapshot).mockImplementationOnce(async () => {
      deleted = true;
    });
    open();
    await screen.findByRole('row', { name: /other-snap/ });
    fireEvent.click(action('Next page'));
    await submitDelete();

    expect(await screen.findByText('No DB cluster snapshots on this page')).toBeInTheDocument();
    fireEvent.click(action('Previous page'));
    expect(await screen.findByRole('row', { name: /other-snap/ })).toBeInTheDocument();
    expect(screen.getByText('DB cluster snapshot orphan-snap deleted')).toBeInTheDocument();
  });

  it('shows the selected identifier and service refusal for an already removed snapshot', async () => {
    vi.mocked(snapshots.deleteClusterSnapshot).mockRejectedValueOnce(
      rejected('DeleteDBClusterSnapshot', 'DBClusterSnapshotNotFoundFault', 'The snapshot no longer exists.'),
    );
    open();
    await submitDelete();

    expect(await screen.findByText('Delete DB cluster snapshot orphan-snap failed')).toBeInTheDocument();
    expect(screen.getByText(/The snapshot no longer exists/)).toBeInTheDocument();
  });

  it('keeps Restore visible and disabled after RestoreDBClusterFromSnapshot returns 501', async () => {
    vi.mocked(snapshots.restoreClusterSnapshot).mockRejectedValueOnce(unsupported('RestoreDBClusterFromSnapshot'));
    open();
    await submitRestore('restored-cluster');

    expect(await screen.findByText('Not implemented by the emulator')).toBeInTheDocument();
    expect(createWrapper(document.body).findFlashbar()?.findItemsByType('info')[0]?.getElement()).toHaveTextContent(
      '501 Not Implemented for RestoreDBClusterFromSnapshot',
    );
    expect(action('Restore')).toBeDisabled();
    expect(action('Delete')).toBeEnabled();
  });

  it('keeps Delete visible and disabled after DeleteDBClusterSnapshot returns 501', async () => {
    vi.mocked(snapshots.deleteClusterSnapshot).mockRejectedValueOnce(unsupported('DeleteDBClusterSnapshot'));
    open();
    await submitDelete();

    expect(await screen.findByText('Not implemented by the emulator')).toBeInTheDocument();
    expect(createWrapper(document.body).findFlashbar()?.findItemsByType('info')[0]?.getElement()).toHaveTextContent(
      '501 Not Implemented for DeleteDBClusterSnapshot',
    );
    expect(action('Delete')).toBeDisabled();
    expect(action('Restore')).toBeEnabled();
  });
});
