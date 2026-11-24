import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useRef, useState } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem, ReadFailure, readFailureState, useAnnouncer } from '../../../components/failure-states';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import { SNAPSHOT_OPERATIONS, type ClusterSnapshot } from '../cluster-snapshot-api';
import { useClusterSnapshotActions, useClusterSnapshotListing } from '../cluster-snapshot-queries';
import { DeleteSnapshotDialog, RestoreSnapshotDialog } from '../components/cluster-snapshot-dialogs';
import { StatusValue } from '../components/status';
import { clusterHref, CLUSTER_SNAPSHOTS_TITLE, NONE } from '../format';

const columns: TableProps.ColumnDefinition<ClusterSnapshot>[] = [
  {
    id: 'id',
    header: 'DB cluster snapshot identifier',
    isRowHeader: true,
    minWidth: '28ch',
    cell: ({ id }) => <ValueText kind="name" value={id} />,
  },
  {
    id: 'source',
    header: 'Source DB cluster',
    minWidth: '28ch',
    cell: ({ sourceId }) => <ValueText kind="name" value={sourceId} none={NONE} />,
  },
  {
    id: 'engine',
    header: 'Engine',
    cell: ({ engine }) => <ValueText kind="fixed" value={engine} none={NONE} />,
  },
  {
    id: 'status',
    header: 'Status',
    minWidth: '18ch',
    cell: ({ status }) => <StatusValue status={status} />,
  },
];

type SnapshotAction = 'restore' | 'delete';
type SnapshotDialog = { kind: 'restore'; id: string; engine: string } | { kind: 'delete'; id: string };
type SnapshotRequest = { kind: 'restore'; id: string; engine: string; newId: string } | { kind: 'delete'; id: string };

export function ClusterSnapshotsPage({ connection }: { connection: AreaConnection }) {
  useShowsResources(CLUSTER_SNAPSHOTS_TITLE);
  const { engineOrigin } = connection;
  const listing = useClusterSnapshotListing(engineOrigin);
  const { items, failure, loading, refresh, goToPage, currentPage, openEnd, pagesCount, pastEnd } = listing;
  const { remove, restore } = useClusterSnapshotActions(engineOrigin);
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
  const [announcement, announce] = useAnnouncer();
  const [selectedId, setSelectedId] = useState<string>();
  const [dialog, setDialog] = useState<SnapshotDialog>();
  const [pending, setPending] = useState(false);
  const [unavailable, setUnavailable] = useState<ReadonlySet<SnapshotAction>>(() => new Set());
  const inFlight = useRef(false);

  const failureState =
    failure === undefined ? undefined : readFailureState(failure, connection, 'DB cluster snapshot list');
  const failureLine = failureState?.firstText;
  const [seenFailure, setSeenFailure] = useState<string>();
  if (seenFailure !== failureLine) {
    setSeenFailure(failureLine);
    if (failureLine !== undefined) announce(failureLine);
  }

  const connectionKind = connection.result?.kind;
  const [seenConnection, setSeenConnection] = useState(connectionKind);
  if (seenConnection !== connectionKind) {
    setSeenConnection(connectionKind);
    if (connectionKind === 'connected' && (seenConnection !== undefined || failure !== undefined)) {
      setSelectedId(undefined);
      // A restarted emulator may no longer accept markers from its previous snapshot list.
      goToPage(1);
    }
  }

  const rows = items ?? [];
  const selected = rows.find((row) => row.id === selectedId);
  const engine = selected?.engine;
  const canRestore =
    !pending && !unavailable.has('restore') && selected?.status === 'available' && engine !== undefined;
  const canDelete = !pending && !unavailable.has('delete') && selected !== undefined;

  const handleDismiss = () => {
    setDialog(undefined);
  };

  const handleAction = async (action: SnapshotRequest) => {
    if (inFlight.current || unavailable.has(action.kind)) return;
    const signal = pageSignal();
    inFlight.current = true;
    setPending(true);
    try {
      if (action.kind === 'restore') {
        const id = await restore(action.id, action.engine, action.newId, signal);
        if (!signal.aborted) {
          flash.handOver(clusterHref(id), [{ type: 'success', content: `Restoring DB cluster ${id}` }]);
        }
      } else {
        await remove(action.id, signal);
        if (!signal.aborted) {
          setSelectedId(undefined);
          flash.show([{ type: 'success', content: `DB cluster snapshot ${action.id} deleted` }]);
        }
      }
    } catch (error) {
      if (signal.aborted) return;
      const failure = failureOf(error, SNAPSHOT_OPERATIONS[action.kind]);
      const subject =
        action.kind === 'restore'
          ? `Restore DB cluster ${action.newId} from snapshot ${action.id}`
          : `Delete DB cluster snapshot ${action.id}`;
      const item = actionFailureItem(failure, subject, engineOrigin);
      if (failure.kind === 'not-implemented') setUnavailable((current) => new Set([...current, action.kind]));
      flash.show([
        failure.kind === 'other' || failure.kind === 'not-implemented'
          ? item
          : {
              ...item,
              content: (
                <>
                  {subject}. {item.content}
                </>
              ),
            },
      ]);
    } finally {
      if (!signal.aborted) {
        inFlight.current = false;
        setPending(false);
        setDialog(undefined);
      }
    }
  };

  const empty =
    failureState !== undefined ? (
      <ReadFailure state={failureState} onRetry={refresh} />
    ) : (
      <Box textAlign="center" color="inherit">
        <Box variant="strong" color="inherit">
          {pastEnd ? 'No DB cluster snapshots on this page' : 'No DB cluster snapshots'}
        </Box>
      </Box>
    );

  return (
    <>
      <Table<ClusterSnapshot>
        variant="full-page"
        items={rows}
        trackBy="id"
        selectionType="single"
        selectedItems={selected === undefined ? [] : [selected]}
        onSelectionChange={({ detail }) => {
          setSelectedId(detail.selectedItems[0]?.id);
        }}
        ariaLabels={{
          selectionGroupLabel: 'DB cluster snapshot selection',
          itemSelectionLabel: (_, row) => row.id,
        }}
        columnDefinitions={columns}
        wrapLines
        loading={loading}
        loadingText="Loading DB cluster snapshots"
        empty={empty}
        header={
          <Header
            variant="awsui-h1-sticky"
            counter={items === undefined ? undefined : `(${String(items.length)}${openEnd ? '+' : ''})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" loading={loading} onClick={refresh} />
                <Button
                  disabled={!canRestore}
                  onClick={() => {
                    if (canRestore) setDialog({ kind: 'restore', id: selected.id, engine });
                  }}
                >
                  Restore
                </Button>
                <Button
                  disabled={!canDelete}
                  onClick={() => {
                    if (canDelete) setDialog({ kind: 'delete', id: selected.id });
                  }}
                >
                  Delete
                </Button>
              </SpaceBetween>
            }
          >
            {CLUSTER_SNAPSHOTS_TITLE}
          </Header>
        }
        pagination={
          <Pagination
            currentPageIndex={currentPage}
            pagesCount={pagesCount}
            openEnd={openEnd}
            disabled={loading || pending}
            ariaLabels={{
              nextPageLabel: 'Next page',
              previousPageLabel: 'Previous page',
              pageLabel: (page) => `Page ${String(page)}`,
            }}
            onChange={({ detail }) => {
              setSelectedId(undefined);
              goToPage(detail.currentPageIndex);
            }}
          />
        }
      />
      {dialog?.kind === 'restore' && (
        <RestoreSnapshotDialog
          target={dialog.id}
          pending={pending}
          onDismiss={handleDismiss}
          onSubmit={(id) => {
            void handleAction({ ...dialog, newId: id });
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteSnapshotDialog
          target={dialog.id}
          pending={pending}
          onDismiss={handleDismiss}
          onConfirm={() => {
            void handleAction(dialog);
          }}
        />
      )}
      {announcement}
    </>
  );
}
