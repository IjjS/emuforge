import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useCallback, useState } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import { readFailureState, ReadFailure, useAnnouncer, type ReadFailureState } from '../../../components/failure-states';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import type { TokenListing } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import type { Cluster } from '../api';
import { DeleteClusterDialog } from '../components/delete-cluster-dialog';
import {
  clusterHref,
  CLUSTERS_TITLE,
  CLUSTERS_WORD,
  CREATE_CLUSTER_PATH,
  CREATE_CLUSTER_TITLE,
  NONE,
  statusText,
} from '../format';
import { useClusterListing } from '../queries';

// The clusters, S1 (issue 575, design tasks 1 and 5): every cluster of the emulator, a page of `ListClusters` and one
// `DescribeClusters` of its ARNs at a time on the API's own tokens, in the API's order. The API has no filter, so the
// list has none. For the one selected cluster, "Delete".

const SELECT_ONE = 'Select one cluster.';

/** A name keeps room for 24 characters (`aws-area.md`, entry 4): 28ch is those 24 and the cell's padding on each side. */
const NAME_MIN_WIDTH = '28ch';

type BodyState =
  | { kind: 'loading' }
  | { kind: 'rows' }
  | { kind: 'empty' }
  | { kind: 'past-end' }
  | { kind: 'failure'; failure: ReadFailureState };

function bodyState(listing: TokenListing<Cluster>, connection: AreaConnection): BodyState {
  if (listing.failure !== undefined) {
    return { kind: 'failure', failure: readFailureState(listing.failure, connection, 'cluster list') };
  }
  if (listing.items === undefined) {
    return { kind: 'loading' };
  }
  if (listing.items.length > 0) {
    return { kind: 'rows' };
  }
  return listing.pastEnd ? { kind: 'past-end' } : { kind: 'empty' };
}

/** The header's counter: the page's rows, with a plus while a next page follows ("(25+)"). */
function counterText(rows: number, openEnd: boolean): string {
  return `(${String(rows)}${openEnd ? '+' : ''})`;
}

/** A count of the answer, "-" when it gave none. */
function countText(value: number | undefined): string {
  return value === undefined ? NONE : String(value);
}

/**
 * `/aws/ecs` and `/aws/ecs/clusters`. A failed read, or a list shown while the connection was not connected, is read
 * again by itself once the connection is connected again.
 */
export function ClusterListPage({ connection }: { connection: AreaConnection }) {
  useShowsResources(CLUSTERS_WORD);
  const handleFollow = useFollow();
  const flash = usePageFlash();
  const [announcement, announce] = useAnnouncer();
  const [selectedName, setSelectedName] = useState<string>();
  const [deleting, setDeleting] = useState<string>();

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
  const selected = rows.find((row) => row.name === selectedName);

  const handlePageChange = ({ detail }: { detail: { currentPageIndex: number } }) => {
    setSelectedName(undefined);
    goToPage(detail.currentPageIndex);
  };

  const handleDeleted = (name: string) => {
    setDeleting(undefined);
    setSelectedName(undefined);
    flash.show([{ type: 'success', content: `Cluster ${name} deleted.` }]);
  };

  const columns: TableProps.ColumnDefinition<Cluster>[] = [
    {
      id: 'name',
      header: 'Name',
      isRowHeader: true,
      minWidth: NAME_MIN_WIDTH,
      cell: (row) => (
        <Link href={clusterHref(row.name)} onFollow={handleFollow}>
          <ValueText kind="name" value={row.name} />
        </Link>
      ),
    },
    { id: 'status', header: 'Status', cell: (row) => <ValueText kind="fixed" value={statusText(row.status)} /> },
    {
      id: 'services',
      header: 'Services',
      cell: (row) => <ValueText kind="fixed" value={countText(row.activeServices)} />,
    },
    {
      id: 'running',
      header: 'Running tasks',
      cell: (row) => <ValueText kind="fixed" value={countText(row.runningTasks)} />,
    },
    {
      id: 'pending',
      header: 'Pending tasks',
      cell: (row) => <ValueText kind="fixed" value={countText(row.pendingTasks)} />,
    },
  ];

  let empty = null;
  if (state.kind === 'empty') {
    empty = (
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            No clusters
          </Box>
          <Box variant="p" color="inherit">
            Create a cluster, or make one with the AWS CLI or an IaC tool pointed at the local emulator.
          </Box>
        </SpaceBetween>
        <Box margin={{ top: 's' }}>
          <Button href={CREATE_CLUSTER_PATH} onFollow={handleFollow}>
            {CREATE_CLUSTER_TITLE}
          </Button>
        </Box>
      </Box>
    );
  } else if (state.kind === 'past-end') {
    empty = (
      <Box textAlign="center" color="inherit">
        <Box variant="strong" color="inherit">
          No more clusters
        </Box>
      </Box>
    );
  } else if (state.kind === 'failure') {
    empty = <ReadFailure state={state.failure} onRetry={handleRetry} />;
  }

  return (
    <>
      <Table<Cluster>
        variant="full-page"
        items={rows}
        trackBy="name"
        selectionType="single"
        selectedItems={selected === undefined ? [] : [selected]}
        onSelectionChange={({ detail }) => {
          setSelectedName(detail.selectedItems[0]?.name);
        }}
        ariaLabels={{
          selectionGroupLabel: 'Cluster selection',
          itemSelectionLabel: (_, row) => row.name,
        }}
        columnDefinitions={columns}
        wrapLines
        loading={state.kind === 'loading'}
        loadingText="Loading clusters"
        empty={empty}
        header={
          <Header
            variant="awsui-h1-sticky"
            counter={items === undefined ? undefined : counterText(items.length, listing.openEnd)}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" loading={listing.loading} onClick={refresh} />
                <Button
                  disabled={selected === undefined}
                  disabledReason={SELECT_ONE}
                  onClick={() => {
                    if (selected !== undefined) {
                      setDeleting(selected.name);
                    }
                  }}
                >
                  Delete
                </Button>
                <Button variant="primary" href={CREATE_CLUSTER_PATH} onFollow={handleFollow}>
                  {CREATE_CLUSTER_TITLE}
                </Button>
              </SpaceBetween>
            }
          >
            {CLUSTERS_TITLE}
          </Header>
        }
        pagination={
          // One page and no next token: nothing to page through, so no pagination.
          listing.pagesCount <= 1 && !listing.openEnd ? undefined : (
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
          )
        }
      />
      <DeleteClusterDialog
        cluster={deleting}
        connection={connection}
        onDeleted={handleDeleted}
        onDismiss={() => {
          setDeleting(undefined);
        }}
      />
      {announcement}
    </>
  );
}
