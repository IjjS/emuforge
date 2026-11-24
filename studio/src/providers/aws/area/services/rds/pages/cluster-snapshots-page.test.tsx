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

const PAGE = createWrapper(document.body);
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

function open(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const router = createMemoryRouter([{ path: '/aws/*', element: <AreaWithStudioProps /> }], { initialEntries: [PATH] });
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

function tableOf(title = 'DB cluster snapshots') {
  return PAGE.findAllTables().find((table) => {
    const slot = table.findHeaderSlot();
    return slot?.findHeader()?.findHeadingText().getElement().textContent === title;
  });
}

function rowIndex(id: string) {
  const table = tableOf();
  if (table === undefined) return -1;
  return table.findRows().findIndex((_, index) => table.findBodyCell(index + 1, 2)?.getElement().textContent === id);
}

async function select(snapshot = ORPHAN) {
  const area = await waitFor(() => {
    const area = tableOf()?.findRowSelectionArea(rowIndex(snapshot.id) + 1);
    if (area == null) throw new Error(`Missing selection control for ${snapshot.id}.`);
    return area.getElement();
  });
  fireEvent.click(within(area).getByRole('radio', { name: snapshot.id }));
}

async function modalOf(title: string) {
  return waitFor(() => {
    const dialog = PAGE.findModal();
    if (dialog === null) throw new Error(`Missing dialog: ${title}.`);
    expect(dialog.findHeader().getElement()).toHaveTextContent(title);
    return dialog;
  });
}

function flashOf(type: 'success' | 'info' | 'error') {
  return PAGE.findFlashbar()?.findItemsByType(type)[0];
}

async function openRestore() {
  await select();
  fireEvent.click(action('Restore'));
  return within((await modalOf('Restore DB cluster from snapshot')).getElement());
}

async function submitRestore(id: string) {
  const dialog = await openRestore();
  fireEvent.change(dialog.getByRole('textbox', { name: 'DB cluster identifier' }), { target: { value: id } });
  fireEvent.click(dialog.getByRole('button', { name: 'Restore' }));
}

async function openDelete() {
  await select();
  fireEvent.click(action('Delete'));
  return modalOf('Delete DB cluster snapshot?');
}

async function submitDelete() {
  const dialog = within((await openDelete()).getElement());
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

    await waitFor(() => expect(rowIndex(OTHER.id)).toBe(0));
    fireEvent.click(action('Next page'));
    await waitFor(() => {
      expect(tableOf()?.findRows()).toHaveLength(1);
      for (const [index, value] of [ORPHAN.id, ORPHAN.sourceId, ORPHAN.engine, ORPHAN.status].entries()) {
        expect(
          tableOf()
            ?.findBodyCell(1, index + 2)
            ?.getElement(),
        ).toHaveTextContent(value);
      }
    });
    expect(rowIndex(OTHER.id)).toBe(-1);
    expect(snapshots.listClusterSnapshots).toHaveBeenNthCalledWith(1, ENGINE, undefined, expect.any(AbortSignal));
    expect(snapshots.listClusterSnapshots).toHaveBeenNthCalledWith(2, ENGINE, MARKER, expect.any(AbortSignal));
  });

  it('shows an empty list and reloads the emulator rows when a failed read is retried', async () => {
    vi.mocked(snapshots.listClusterSnapshots)
      .mockResolvedValueOnce({ items: [] })
      .mockRejectedValueOnce(rejected('DescribeDBClusterSnapshots', 'InternalFailure', 'Snapshot read failed.'));
    open();

    const empty = await waitFor(() => {
      const slot = tableOf()?.findEmptySlot()?.getElement();
      expect(slot).toHaveTextContent('No DB cluster snapshots');
      expect(slot).toHaveTextContent('open an Aurora DB cluster and choose Take snapshot.');
      return slot as HTMLElement;
    });
    expect(within(empty).getByRole('link', { name: 'DB clusters' })).toHaveAttribute('href', '/aws/rds/clusters');
    fireEvent.click(action('Refresh'));
    await waitFor(() => expect(tableOf()?.findEmptySlot()?.getElement()).toHaveTextContent('Snapshot read failed.'));
    fireEvent.click(action('Retry'));
    await waitFor(() => expect(rowIndex(ORPHAN.id)).toBe(0));
  });

  it('shows the operation that is unsupported when DescribeDBClusterSnapshots returns 501', async () => {
    vi.mocked(snapshots.listClusterSnapshots).mockRejectedValueOnce(unsupported('DescribeDBClusterSnapshots'));
    open();

    await waitFor(() => {
      const empty = tableOf()?.findEmptySlot()?.getElement();
      expect(empty).toHaveTextContent('Not implemented by the emulator');
      expect(empty).toHaveTextContent('501 Not Implemented for DescribeDBClusterSnapshots');
    });
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
    const status = tableOf()?.findHeaderSlot()?.findHeader()?.findDescription()?.getElement();
    expect(status).toHaveTextContent('Selected snapshot status: creating');
    expect(status).toHaveTextContent('Restore requires an available snapshot.');
    expect(status?.closest('table')).toBeNull();
    expect(action('Restore')).toHaveAccessibleDescription(
      expect.stringContaining('Restore requires an available snapshot.'),
    );
    await select();
    expect(status).toHaveTextContent('Selected snapshot status: available');
    expect(status).not.toHaveTextContent('Restore requires an available snapshot.');
    await submitRestore('requested-cluster');

    expect(snapshots.restoreClusterSnapshot).toHaveBeenCalledWith(
      ENGINE,
      ORPHAN.id,
      ORPHAN.engine,
      'requested-cluster',
      expect.any(AbortSignal),
    );
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
    await act(async () => {
      members.resolve([]);
      await members.promise;
    });

    await waitFor(() => {
      expect(tableOf('DB instances')?.findEmptySlot()?.getElement()).toHaveTextContent('No DB instances');
      const status = PAGE.findAllKeyValuePairs()
        .flatMap((group) => group.findItems())
        .find((item) => item.findLabel()?.getElement().textContent === 'Status');
      expect(status?.findValue()?.getElement()).toHaveTextContent('available');
      expect(PAGE.findAllHeaders().map((header) => header.findHeadingText().getElement().textContent)).toContain(
        'restored-cluster',
      );
      expect(flashOf('success')?.findContent()?.getElement()).toHaveTextContent(
        'Restoring DB cluster restored-cluster',
      );
    });
    expect(router.state.location.pathname).toBe('/aws/rds/clusters/cluster/restored-cluster');
    expect(screen.getAllByRole('link', { name: 'Add DB instance' })[0]).toHaveAttribute(
      'href',
      '/aws/rds/clusters/cluster/restored-cluster/add-instance',
    );
  });

  it('shows the duplicate restore refusal and reopens the draft for correction', async () => {
    vi.mocked(snapshots.restoreClusterSnapshot).mockRejectedValueOnce(
      rejected('RestoreDBClusterFromSnapshot', 'DBClusterAlreadyExistsFault', 'A cluster with this identifier exists.'),
    );
    const router = open();
    await submitRestore('existing-cluster');

    await waitFor(() => {
      expect(flashOf('error')?.findHeader()?.getElement()).toHaveTextContent(
        'Restore DB cluster existing-cluster from snapshot orphan-snap failed',
      );
      expect(flashOf('error')?.findContent()?.getElement()).toHaveTextContent('A cluster with this identifier exists.');
    });
    expect(router.state.location.pathname).toBe(PATH);

    const dialog = await openRestore();
    const input = dialog.getByRole('textbox', { name: 'DB cluster identifier' });
    expect(input).toHaveAccessibleDescription(
      expect.stringContaining('Restore creates a new DB cluster with this identifier.'),
    );
    expect(input).toHaveValue('existing-cluster');
    vi.mocked(clusters.getCluster).mockResolvedValue({ found: false });
    vi.mocked(clusters.listMembers).mockResolvedValue([]);
    fireEvent.change(input, { target: { value: 'restored-cluster' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Restore' }));
    await waitFor(() => {
      expect(flashOf('success')?.findContent()?.getElement()).toHaveTextContent(
        'Restoring DB cluster restored-cluster',
      );
    });
    expect(snapshots.restoreClusterSnapshot).toHaveBeenLastCalledWith(
      ENGINE,
      ORPHAN.id,
      ORPHAN.engine,
      'restored-cluster',
      expect.any(AbortSignal),
    );
  });

  it('requires the exact confirmation word and leaves the snapshot when cancelled', async () => {
    open();
    const modal = await openDelete();
    expect(modal.findContent().getElement()).toHaveTextContent('Delete orphan-snap from the local emulator');
    const dialog = within(modal.getElement());
    const confirm = dialog.getByRole('button', { name: 'Delete' });
    const input = dialog.getByRole('textbox');

    expect(confirm).toBeDisabled();
    fireEvent.change(input, { target: { value: 'Delete' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(input, { target: { value: 'delete' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));

    expect(PAGE.findModal()).toBeNull();
    expect(rowIndex(ORPHAN.id)).toBe(0);
    expect(snapshots.deleteClusterSnapshot).not.toHaveBeenCalled();
  });

  it('keeps the deletion result when the refreshed list has already dropped the selected row', async () => {
    const mutation = deferred<undefined>();
    const list = deferred<Awaited<ReturnType<typeof snapshots.listClusterSnapshots>>>();
    vi.mocked(snapshots.deleteClusterSnapshot).mockReturnValueOnce(mutation.promise);
    vi.mocked(snapshots.listClusterSnapshots)
      .mockResolvedValueOnce({ items: [ORPHAN] })
      .mockReturnValueOnce(list.promise)
      .mockResolvedValue({ items: [] });
    const client = new QueryClient();
    open(client);
    await submitDelete();

    expect(snapshots.deleteClusterSnapshot).toHaveBeenCalledWith(ENGINE, ORPHAN.id, expect.any(AbortSignal));
    // An independent refetch can observe the deletion before its response reaches the page.
    act(() => {
      void client.invalidateQueries();
    });
    await waitFor(() => expect(snapshots.listClusterSnapshots).toHaveBeenCalledTimes(2));
    await act(async () => {
      list.resolve({ items: [] });
      await list.promise;
    });
    await waitFor(() => {
      expect(tableOf()?.findEmptySlot()?.getElement()).toHaveTextContent('No DB cluster snapshots');
      expect(tableOf()?.findSelectedRows()).toHaveLength(0);
      expect(rowIndex(ORPHAN.id)).toBe(-1);
      expect(PAGE.findModal()).toBeNull();
    });
    expect(flashOf('success')).toBeUndefined();

    await act(async () => {
      mutation.resolve(undefined);
      await mutation.promise;
    });
    await waitFor(() => {
      expect(PAGE.findModal()).toBeNull();
      expect(rowIndex(ORPHAN.id)).toBe(-1);
      expect(flashOf('success')?.findContent()?.getElement()).toHaveTextContent(
        'DB cluster snapshot orphan-snap deleted',
      );
    });
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
    await waitFor(() => expect(rowIndex(OTHER.id)).toBe(0));
    fireEvent.click(action('Next page'));
    await submitDelete();

    await waitFor(() => {
      expect(tableOf()?.findEmptySlot()?.getElement()).toHaveTextContent('No DB cluster snapshots on this page');
    });
    fireEvent.click(action('Previous page'));
    await waitFor(() => expect(rowIndex(OTHER.id)).toBe(0));
    expect(flashOf('success')?.findContent()?.getElement()).toHaveTextContent(
      'DB cluster snapshot orphan-snap deleted',
    );
  });

  it('shows the selected identifier and service refusal for an already removed snapshot', async () => {
    vi.mocked(snapshots.deleteClusterSnapshot).mockRejectedValueOnce(
      rejected('DeleteDBClusterSnapshot', 'DBClusterSnapshotNotFoundFault', 'The snapshot no longer exists.'),
    );
    open();
    await submitDelete();

    await waitFor(() => {
      expect(flashOf('error')?.findHeader()?.getElement()).toHaveTextContent(
        'Delete DB cluster snapshot orphan-snap failed',
      );
      expect(flashOf('error')?.findContent()?.getElement()).toHaveTextContent('The snapshot no longer exists.');
    });
  });

  it('keeps Restore visible and disabled after RestoreDBClusterFromSnapshot returns 501', async () => {
    vi.mocked(snapshots.restoreClusterSnapshot).mockRejectedValueOnce(unsupported('RestoreDBClusterFromSnapshot'));
    open();
    await submitRestore('restored-cluster');

    await waitFor(() => {
      expect(flashOf('info')?.findHeader()?.getElement()).toHaveTextContent('Not implemented by the emulator');
      expect(flashOf('info')?.findContent()?.getElement()).toHaveTextContent(
        '501 Not Implemented for RestoreDBClusterFromSnapshot',
      );
    });
    expect(action('Restore')).toBeDisabled();
    expect(action('Delete')).toBeEnabled();
  });

  it('keeps Delete visible and disabled after DeleteDBClusterSnapshot returns 501', async () => {
    vi.mocked(snapshots.deleteClusterSnapshot).mockRejectedValueOnce(unsupported('DeleteDBClusterSnapshot'));
    open();
    await submitDelete();

    await waitFor(() => {
      expect(flashOf('info')?.findHeader()?.getElement()).toHaveTextContent('Not implemented by the emulator');
      expect(flashOf('info')?.findContent()?.getElement()).toHaveTextContent(
        '501 Not Implemented for DeleteDBClusterSnapshot',
      );
    });
    expect(action('Delete')).toBeDisabled();
    expect(action('Restore')).toBeEnabled();
  });
});
