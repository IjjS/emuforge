import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useId, useLayoutEffect, useRef, useState } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem, ReadFailure, readFailureState, useAnnouncer } from '../../../components/failure-states';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import { SNAPSHOT_OPERATIONS, type ClusterSnapshot } from '../cluster-snapshot-api';
import { useClusterSnapshotActions, useClusterSnapshotListing } from '../cluster-snapshot-queries';
import { DeleteSnapshotDialog, RestoreSnapshotDialog } from '../components/cluster-snapshot-dialogs';
import { StatusValue } from '../components/status';
import { clusterHref, CLUSTER_SNAPSHOTS_TITLE, CLUSTERS_PATH, NONE } from '../format';

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
type SnapshotDialog =
  | { kind: 'restore'; id: string; engine: string; initialIdentifier?: string | undefined }
  | { kind: 'delete'; id: string };
type SnapshotRequest = { kind: 'restore'; id: string; engine: string; newId: string } | { kind: 'delete'; id: string };

function restoreReason(snapshot: ClusterSnapshot | undefined, unsupported: boolean): string | undefined {
  if (unsupported) return 'The emulator does not implement RestoreDBClusterFromSnapshot.';
  if (snapshot === undefined) return 'Select a DB cluster snapshot.';
  if (snapshot.status !== 'available') return 'Restore requires an available snapshot.';
  if (snapshot.engine === undefined) return 'Restore requires the snapshot’s engine.';
  return undefined;
}

export function ClusterSnapshotsPage({ connection }: { connection: AreaConnection }) {
  useShowsResources(CLUSTER_SNAPSHOTS_TITLE);
  const { engineOrigin } = connection;
  const listing = useClusterSnapshotListing(engineOrigin);
  const { items, failure, loading, refresh, goToPage, currentPage, openEnd, pagesCount, pastEnd } = listing;
  const { remove, restore } = useClusterSnapshotActions(engineOrigin);
  const flash = usePageFlash();
  const handleFollow = useFollow();
  const selectionStatusId = useId();
  const pageSignal = usePageSignal();
  const [announcement, announce] = useAnnouncer();
  const [selectedId, setSelectedId] = useState<string>();
  const [dialog, setDialog] = useState<SnapshotDialog>();
  const [retry, setRetry] = useState<{ snapshotId: string; identifier: string }>();
  const [pending, setPending] = useState(false);
  const [unavailable, setUnavailable] = useState<ReadonlySet<SnapshotAction>>(() => new Set());
  const inFlight = useRef(false);
  const refreshButton = useRef<ButtonProps.Ref>(null);
  const wasDeleteOpen = useRef(false);

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
  // A completed list read can observe the deletion before the page receives the mutation result.
  if (dialog?.kind === 'delete' && items !== undefined && !items.some((row) => row.id === dialog.id)) {
    setDialog(undefined);
  }
  const engine = selected?.engine;
  const reason = restoreReason(selected, unavailable.has('restore'));
  const canRestore = !pending && reason === undefined;
  const canDelete = !pending && !unavailable.has('delete') && selected !== undefined;

  const deleteOpen = dialog?.kind === 'delete';
  useLayoutEffect(() => {
    const closed = wasDeleteOpen.current && !deleteOpen;
    wasDeleteOpen.current = deleteOpen;
    if (!closed || canDelete) return;

    // Cloudscape has tried to restore the opener during unmount. Move focus only if it was lost.
    const active = document.activeElement;
    if (active === null || active === document.body || !active.isConnected) {
      refreshButton.current?.focus();
    }
  }, [canDelete, deleteOpen]);

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
      if (failure.kind === 'not-implemented') {
        setUnavailable((current) => new Set([...current, action.kind]));
      } else if (action.kind === 'restore') {
        setRetry({ snapshotId: action.id, identifier: action.newId });
      }
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
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            {pastEnd ? 'No DB cluster snapshots on this page' : 'No DB cluster snapshots'}
          </Box>
          {!pastEnd && (
            <Box variant="p" color="inherit">
              In{' '}
              <Link href={CLUSTERS_PATH} onFollow={handleFollow}>
                DB clusters
              </Link>
              , open an Aurora DB cluster and choose Take snapshot.
            </Box>
          )}
        </SpaceBetween>
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
            description={
              <span id={selectionStatusId} aria-live="polite">
                {selected !== undefined && (
                  <>
                    Selected snapshot status: <StatusValue status={selected.status} />
                    {reason !== undefined && (
                      <>
                        <br />
                        <span>{reason}</span>
                      </>
                    )}
                  </>
                )}
              </span>
            }
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button
                  ref={refreshButton}
                  iconName="refresh"
                  ariaLabel="Refresh"
                  loading={loading}
                  onClick={refresh}
                />
                <Button
                  disabled={!canRestore}
                  ariaDescribedby={selectionStatusId}
                  onClick={() => {
                    if (!canRestore || selected === undefined || engine === undefined) return;
                    const initialIdentifier = retry?.snapshotId === selected.id ? retry.identifier : undefined;
                    if (initialIdentifier !== undefined) setRetry(undefined);
                    setDialog({ kind: 'restore', id: selected.id, engine, initialIdentifier });
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
          initialIdentifier={dialog.initialIdentifier}
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
