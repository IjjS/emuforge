import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useCallback, useState } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import {
  actionFailureItem,
  readFailureState,
  ReadFailure,
  useAnnouncer,
  type ReadFailureState,
} from '../../../components/failure-states';
import { creationDateText } from '../../../components/format-date';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { failureOf, usePageSignal, type TokenListing } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import { CLUSTER_OPERATIONS, type DbCluster } from '../cluster-api';
import { deleteTarget } from '../cluster-delete';
import { useClusterDelete, useClusterListing } from '../cluster-queries';
import { ClusterDeleteAction } from '../components/cluster-delete-action';
import { StatusValue } from '../components/status';
import {
  clusterHref,
  CLUSTER_SNAPSHOTS_PATH,
  CLUSTER_SNAPSHOTS_TITLE,
  CLUSTERS_TITLE,
  CLUSTERS_WORD,
  CREATE_CLUSTER_PATH,
  engineText,
  NONE,
} from '../format';

// The DB clusters, S4 (issue 573, design task 4): every DB cluster of the emulator, a page of `DescribeDBClusters` at
// a time on the API's markers, in the API's order, of every engine. For the one selected row, "Delete"; this page
// holds its request and shows its answer.

/** A name keeps room for 24 characters (`aws-area.md`, entry 4). */
const NAME_MIN_WIDTH = '28ch';
/** A status's icon, its gap, its word up to "rebooting" or "modifying" and the cell's padding on one line. */
const STATUS_MIN_WIDTH = '18ch';
/** A creation time on two lines at most. */
const CREATED_MIN_WIDTH = '26ch';

type BodyState =
  { kind: 'loading' } | { kind: 'rows' } | { kind: 'empty' } | { kind: 'failure'; failure: ReadFailureState };

function bodyState(listing: TokenListing<DbCluster>, connection: AreaConnection): BodyState {
  if (listing.failure !== undefined) {
    return { kind: 'failure', failure: readFailureState(listing.failure, connection, 'DB cluster list') };
  }
  if (listing.items === undefined) {
    return { kind: 'loading' };
  }
  return listing.items.length > 0 ? { kind: 'rows' } : { kind: 'empty' };
}

/** The header's counter: the page's rows, with a plus while a next page follows ("(50+)"). */
function counterText(rows: number, openEnd: boolean): string {
  return `(${String(rows)}${openEnd ? '+' : ''})`;
}

/**
 * `/aws/rds/clusters`. A failed read, or a list shown while the connection was not connected, is read again
 * by itself once the connection is connected again, so after an emulator restart it shows the empty emulator.
 */
export function ClusterListPage({ connection }: { connection: AreaConnection }) {
  useShowsResources(CLUSTERS_WORD);
  const handleFollow = useFollow();
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
  const remove = useClusterDelete(connection.engineOrigin);
  const [announcement, announce] = useAnnouncer();
  const [selectedId, setSelectedId] = useState<string>();
  const [pending, setPending] = useState(false);

  const listing = useClusterListing(connection.engineOrigin);
  const { items, refresh, currentPage, goToPage } = listing;
  const state = bodyState(listing, connection);
  const loaded = items !== undefined;

  const handleRetry = useCallback(() => {
    refresh();
  }, [refresh]);

  // Kept from the previous render, as React's own pattern for it, so each change is acted on once.
  const failureLine = state.kind === 'failure' ? state.failure.firstText : undefined;
  const [seenFailureLine, setSeenFailureLine] = useState<string>();
  const connected = connection.result?.kind === 'connected';
  const [seenConnected, setSeenConnected] = useState(connected);
  const down = connection.result !== undefined && !connected;
  const [wasDown, setWasDown] = useState(down);
  if (down && !wasDown) {
    setWasDown(true);
  }
  if (failureLine !== seenFailureLine) {
    setSeenFailureLine(failureLine);
    if (failureLine !== undefined) {
      announce(failureLine);
    }
  }
  if (connected !== seenConnected) {
    setSeenConnected(connected);
    if (connected && (listing.failure !== undefined || wasDown)) {
      setWasDown(false);
      refresh();
    }
  }

  const rows = items ?? [];
  const selected = rows.find((row) => row.id === selectedId);

  const handleDelete = (id: string) => {
    if (pending) {
      return;
    }
    const signal = pageSignal();
    setPending(true);
    remove(id, signal).then(
      () => {
        if (signal.aborted) return;
        setPending(false);
        flash.show([{ type: 'success', content: `Deleting DB cluster ${id}` }]);
      },
      (error: unknown) => {
        if (signal.aborted) return;
        setPending(false);
        flash.show([
          actionFailureItem(
            failureOf(error, CLUSTER_OPERATIONS.deleteDBCluster),
            `Delete DB cluster ${id}`,
            connection.engineOrigin,
          ),
        ]);
      },
    );
  };

  const handlePageChange = ({ detail }: { detail: { currentPageIndex: number } }) => {
    setSelectedId(undefined);
    goToPage(detail.currentPageIndex);
  };

  const columns: TableProps.ColumnDefinition<DbCluster>[] = [
    {
      id: 'id',
      header: 'DB cluster identifier',
      isRowHeader: true,
      minWidth: NAME_MIN_WIDTH,
      cell: (row) => (
        <Link href={clusterHref(row.id)} onFollow={handleFollow}>
          <ValueText kind="name" value={row.id} />
        </Link>
      ),
    },
    { id: 'status', header: 'Status', minWidth: STATUS_MIN_WIDTH, cell: (row) => <StatusValue status={row.status} /> },
    {
      id: 'engine',
      header: 'Engine',
      cell: (row) => <ValueText kind="fixed" value={engineText(row.engine, row.engineVersion)} none={NONE} />,
    },
    {
      id: 'members',
      header: 'DB instances',
      cell: (row) => <ValueText kind="fixed" value={String(row.members.length)} />,
    },
    {
      id: 'port',
      header: 'Port',
      cell: (row) => (
        <ValueText kind="fixed" value={row.port === undefined ? undefined : String(row.port)} none={NONE} />
      ),
    },
    {
      id: 'created',
      header: 'Created',
      minWidth: CREATED_MIN_WIDTH,
      cell: (row) => <ValueText kind="fixed" value={creationDateText(row.createdAt)} />,
    },
  ];

  let empty = null;
  if (state.kind === 'empty') {
    empty = (
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            No DB clusters
          </Box>
          <Box variant="p" color="inherit">
            The emulator holds no DB cluster yet.
          </Box>
        </SpaceBetween>
        <Box margin={{ top: 's' }}>
          <Button href={CREATE_CLUSTER_PATH} onFollow={handleFollow}>
            Create DB cluster
          </Button>
        </Box>
      </Box>
    );
  } else if (state.kind === 'failure') {
    empty = <ReadFailure state={state.failure} onRetry={handleRetry} />;
  }

  return (
    <>
      <Table<DbCluster>
        variant="full-page"
        items={rows}
        trackBy="id"
        selectionType="single"
        selectedItems={selected === undefined ? [] : [selected]}
        onSelectionChange={({ detail }) => {
          setSelectedId(detail.selectedItems[0]?.id);
        }}
        ariaLabels={{
          selectionGroupLabel: 'DB cluster selection',
          itemSelectionLabel: (_, row) => row.id,
        }}
        columnDefinitions={columns}
        wrapLines
        loading={state.kind === 'loading'}
        loadingText="Loading DB clusters"
        empty={empty}
        header={
          <Header
            variant="awsui-h1-sticky"
            counter={items === undefined ? undefined : counterText(items.length, listing.openEnd)}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" loading={listing.loading} onClick={refresh} />
                <ClusterDeleteAction
                  cluster={selected === undefined ? undefined : deleteTarget(selected)}
                  pending={pending}
                  onDelete={handleDelete}
                />
                <Link href={CLUSTER_SNAPSHOTS_PATH} onFollow={handleFollow}>
                  {CLUSTER_SNAPSHOTS_TITLE}
                </Link>
                <Button variant="primary" href={CREATE_CLUSTER_PATH} onFollow={handleFollow}>
                  Create DB cluster
                </Button>
              </SpaceBetween>
            }
          >
            {CLUSTERS_TITLE}
          </Header>
        }
        pagination={
          <Pagination
            currentPageIndex={currentPage}
            pagesCount={listing.pagesCount}
            openEnd={listing.openEnd}
            disabled={!loaded}
            ariaLabels={{
              nextPageLabel: 'Next page',
              previousPageLabel: 'Previous page',
              pageLabel: (page) => `Page ${String(page)}`,
            }}
            onChange={handlePageChange}
          />
        }
      />
      {announcement}
    </>
  );
}
