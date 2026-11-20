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
import { ACTION_OPERATIONS, type DbInstance } from '../api';
import { InstanceActions } from '../components/instance-actions';
import { StatusValue } from '../components/status';
import {
  clusterHref,
  CREATE_INSTANCE_PATH,
  engineText,
  instanceHref,
  INSTANCES_TITLE,
  INSTANCES_WORD,
  NONE,
} from '../format';
import { useInstanceAction, useInstanceListing } from '../queries';
import { ACTION_LABELS, ACTION_RESULTS, actionTarget, type ActionTarget, type InstanceAction } from '../status';

// The DB instances, S1 (issue 573, design tasks 1 and 3): every DB instance of the emulator, a page of
// `DescribeDBInstances` at a time on the API's markers, in the API's order, a cluster's members among them. For the
// one selected row, the instance's actions; this page holds their request and shows their answer.

/** A name keeps room for 24 characters (`aws-area.md`, entry 4). */
const NAME_MIN_WIDTH = '28ch';
/** A status's icon and its word on one line, up to "rebooting". */
const STATUS_MIN_WIDTH = '14ch';
/** A creation time on two lines at most. */
const CREATED_MIN_WIDTH = '26ch';

type BodyState =
  { kind: 'loading' } | { kind: 'rows' } | { kind: 'empty' } | { kind: 'failure'; failure: ReadFailureState };

function bodyState(listing: TokenListing<DbInstance>, connection: AreaConnection): BodyState {
  if (listing.failure !== undefined) {
    return { kind: 'failure', failure: readFailureState(listing.failure, connection, 'DB instance list') };
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
 * `/aws/rds` and `/aws/rds/instances`. A failed read, or a list shown while the connection was not connected, is read
 * again by itself once the connection is connected again, so after an emulator restart it shows the empty emulator.
 */
export function InstanceListPage({ connection }: { connection: AreaConnection }) {
  useShowsResources(INSTANCES_WORD);
  const handleFollow = useFollow();
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
  const act = useInstanceAction(connection.engineOrigin);
  const [announcement, announce] = useAnnouncer();
  const [selectedId, setSelectedId] = useState<string>();
  const [pending, setPending] = useState(false);

  const listing = useInstanceListing(connection.engineOrigin);
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

  const handleAction = (action: InstanceAction, target: ActionTarget) => {
    if (pending) {
      return;
    }
    const signal = pageSignal();
    setPending(true);
    act(action, target.id, signal).then(
      () => {
        if (signal.aborted) return;
        setPending(false);
        flash.show([{ type: 'success', content: `${ACTION_RESULTS[action]} ${target.id}` }]);
      },
      (error: unknown) => {
        if (signal.aborted) return;
        setPending(false);
        flash.show([
          actionFailureItem(
            failureOf(error, ACTION_OPERATIONS[action]),
            `${ACTION_LABELS[action]} DB instance ${target.id}`,
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

  const columns: TableProps.ColumnDefinition<DbInstance>[] = [
    {
      id: 'id',
      header: 'DB identifier',
      isRowHeader: true,
      minWidth: NAME_MIN_WIDTH,
      cell: (row) => (
        <Link href={instanceHref(row.id)} onFollow={handleFollow}>
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
    { id: 'class', header: 'Class', cell: (row) => <ValueText kind="name" value={row.instanceClass} none={NONE} /> },
    {
      id: 'cluster',
      header: 'DB cluster',
      cell: (row) =>
        row.clusterId === undefined ? (
          NONE
        ) : (
          <Link href={clusterHref(row.clusterId)} onFollow={handleFollow}>
            <ValueText kind="name" value={row.clusterId} />
          </Link>
        ),
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
            No DB instances
          </Box>
          <Box variant="p" color="inherit">
            The emulator holds no DB instance yet.
          </Box>
        </SpaceBetween>
        <Box margin={{ top: 's' }}>
          <Button href={CREATE_INSTANCE_PATH} onFollow={handleFollow}>
            Create DB instance
          </Button>
        </Box>
      </Box>
    );
  } else if (state.kind === 'failure') {
    empty = <ReadFailure state={state.failure} onRetry={handleRetry} />;
  }

  return (
    <>
      <Table<DbInstance>
        variant="full-page"
        items={rows}
        trackBy="id"
        selectionType="single"
        selectedItems={selected === undefined ? [] : [selected]}
        onSelectionChange={({ detail }) => {
          setSelectedId(detail.selectedItems[0]?.id);
        }}
        ariaLabels={{
          selectionGroupLabel: 'DB instance selection',
          itemSelectionLabel: (_, row) => row.id,
        }}
        columnDefinitions={columns}
        wrapLines
        loading={state.kind === 'loading'}
        loadingText="Loading DB instances"
        empty={empty}
        header={
          <Header
            variant="awsui-h1-sticky"
            counter={items === undefined ? undefined : counterText(items.length, listing.openEnd)}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" loading={listing.loading} onClick={refresh} />
                <InstanceActions
                  instance={selected === undefined ? undefined : actionTarget(selected)}
                  pending={pending}
                  onAction={handleAction}
                />
                <Button variant="primary" href={CREATE_INSTANCE_PATH} onFollow={handleFollow}>
                  Create DB instance
                </Button>
              </SpaceBetween>
            }
          >
            {INSTANCES_TITLE}
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
