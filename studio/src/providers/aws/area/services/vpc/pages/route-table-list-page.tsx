import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import TextFilter from '@cloudscape-design/components/text-filter';
import { useCallback, useState } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import { readFailureState, ReadFailure, useAnnouncer, type ReadFailureState } from '../../../components/failure-states';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import type { TokenListing } from '../../../components/use-token-listing';
import { nameIdentity } from '../../../components/name-identity';
import { NameText } from '../../../components/name-text';
import { ValueText } from '../../../components/value-text';
import type { RouteTable } from '../api';
import { DeleteRouteTableDialog, type RouteTableTarget } from '../components/delete-route-table-dialog';
import {
  CREATE_ROUTE_TABLE_PATH,
  CREATE_ROUTE_TABLE_TITLE,
  ID_MIN_WIDTH,
  NAME_FILTER_DESCRIPTION,
  nameOrId,
  NONE,
  resourceName,
  ROUTE_TABLES_TITLE,
  ROUTE_TABLES_WORD,
  routeTableHref,
  vpcHref,
} from '../format';
import { useRouteTableListing } from '../queries';

// The route tables, S7 (issue 574, design task 1 and 3): every route table of the emulator, a page of `DescribeRouteTables`
// at a time on its own tokens, in the API's order. The name filter is the API's, `tag:Name` with `*` around it, sent
// once the text has settled, and part of the page's request. A further page that comes back empty is shown as the
// list's end. For the one selected table, "Delete", unavailable for a VPC's main table.

const SELECT_ONE = 'Select one route table.';
const MAIN_REASON = "A VPC's main route table cannot be deleted.";

/** A name keeps room for 24 characters (`aws-area.md`, entry 4): 28ch is those 24 and the cell's padding on each side. */
const NAME_MIN_WIDTH = '28ch';

type BodyState =
  | { kind: 'loading' }
  | { kind: 'rows' }
  | { kind: 'empty' }
  | { kind: 'no-match' }
  | { kind: 'past-end' }
  | { kind: 'failure'; failure: ReadFailureState };

function bodyState(listing: TokenListing<RouteTable>, connection: AreaConnection, filtered: boolean): BodyState {
  if (listing.failure !== undefined) {
    return { kind: 'failure', failure: readFailureState(listing.failure, connection, 'route table list') };
  }
  if (listing.items === undefined) {
    return { kind: 'loading' };
  }
  if (listing.items.length > 0) {
    return { kind: 'rows' };
  }
  if (listing.pastEnd) {
    return { kind: 'past-end' };
  }
  return filtered ? { kind: 'no-match' } : { kind: 'empty' };
}

/** The header's counter: the page's rows, with a plus while a next page follows ('(50+)'). */
function counterText(rows: number, openEnd: boolean): string {
  return `(${String(rows)}${openEnd ? '+' : ''})`;
}

/**
 * `/aws/vpc/route-tables`. A failed read, or a list shown while the connection was not connected, is read again by itself
 * once the connection is connected again, so after an emulator restart it shows the default VPC's main table alone.
 */
export function RouteTableListPage({ connection }: { connection: AreaConnection }) {
  useShowsResources(ROUTE_TABLES_WORD);
  const handleFollow = useFollow();
  const flash = usePageFlash();
  const [announcement, announce] = useAnnouncer();
  const [nameText, setNameText] = useState('');
  const [name, setName] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [deleting, setDeleting] = useState<RouteTableTarget>();

  const listing = useRouteTableListing(connection.engineOrigin, { name });
  const { items, refresh, currentPage, goToPage } = listing;
  const state = bodyState(listing, connection, name !== '');
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
  const deleteReason = selected === undefined ? SELECT_ONE : selected.main ? MAIN_REASON : undefined;

  const changeName = (next: string) => {
    setSelectedId(undefined);
    setName(next);
  };

  const handleClearFilter = () => {
    setNameText('');
    changeName('');
  };

  const handlePageChange = ({ detail }: { detail: { currentPageIndex: number } }) => {
    setSelectedId(undefined);
    goToPage(detail.currentPageIndex);
  };

  const handleDeleted = (table: RouteTableTarget) => {
    setDeleting(undefined);
    setSelectedId(undefined);
    flash.show([{ type: 'success', content: `Deleted route table ${table.label}` }]);
  };

  const columns: TableProps.ColumnDefinition<RouteTable>[] = [
    {
      id: 'name',
      header: 'Name',
      minWidth: NAME_MIN_WIDTH,
      cell: (row) => <NameText name={resourceName(row.tags)} />,
    },
    {
      id: 'id',
      header: 'Route table ID',
      isRowHeader: true,
      minWidth: ID_MIN_WIDTH,
      cell: (row) => (
        <Link href={routeTableHref(row.id)} onFollow={handleFollow}>
          <ValueText kind="name" value={row.id} />
        </Link>
      ),
    },
    {
      id: 'vpc',
      header: 'VPC ID',
      minWidth: ID_MIN_WIDTH,
      cell: (row) =>
        row.vpcId === undefined ? (
          <ValueText kind="name" value={undefined} none={NONE} />
        ) : (
          <Link href={vpcHref(row.vpcId)} onFollow={handleFollow}>
            <ValueText kind="name" value={row.vpcId} />
          </Link>
        ),
    },
    { id: 'main', header: 'Main', cell: (row) => <ValueText kind="fixed" value={row.main ? 'Yes' : 'No'} /> },
    {
      id: 'subnets',
      header: 'Associated subnets',
      cell: (row) => <ValueText kind="fixed" value={String(row.subnetCount)} />,
    },
  ];

  let empty = null;
  if (state.kind === 'empty') {
    empty = (
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            No route tables
          </Box>
          <Box variant="p" color="inherit">
            The emulator holds no route table.
          </Box>
        </SpaceBetween>
        <Box margin={{ top: 's' }}>
          <Button href={CREATE_ROUTE_TABLE_PATH} onFollow={handleFollow}>
            {CREATE_ROUTE_TABLE_TITLE}
          </Button>
        </Box>
      </Box>
    );
  } else if (state.kind === 'no-match') {
    empty = (
      <Box textAlign="center" color="inherit">
        <Box variant="strong" color="inherit">
          No route tables match
        </Box>
        <Box margin={{ top: 's' }}>
          <Button onClick={handleClearFilter}>Clear filter</Button>
        </Box>
      </Box>
    );
  } else if (state.kind === 'past-end') {
    empty = (
      <Box textAlign="center" color="inherit">
        <Box variant="strong" color="inherit">
          No more route tables
        </Box>
      </Box>
    );
  } else if (state.kind === 'failure') {
    empty = <ReadFailure state={state.failure} onRetry={handleRetry} />;
  }

  return (
    <>
      <Table<RouteTable>
        variant="full-page"
        items={rows}
        trackBy="id"
        selectionType="single"
        selectedItems={selected === undefined ? [] : [selected]}
        onSelectionChange={({ detail }) => {
          setSelectedId(detail.selectedItems[0]?.id);
        }}
        ariaLabels={{
          selectionGroupLabel: 'Route table selection',
          itemSelectionLabel: (_, row) => nameIdentity(nameOrId(row.id, row.tags)),
        }}
        columnDefinitions={columns}
        wrapLines
        loading={state.kind === 'loading'}
        loadingText="Loading route tables"
        empty={empty}
        filter={
          <TextFilter
            filteringText={nameText}
            filteringPlaceholder="Find by name"
            filteringAriaLabel="Name"
            filteringClearAriaLabel="Clear the name filter"
            onChange={({ detail }) => {
              setNameText(detail.filteringText);
            }}
            onDelayedChange={({ detail }) => {
              if (detail.filteringText !== name) {
                changeName(detail.filteringText);
              }
            }}
          />
        }
        header={
          <Header
            variant="awsui-h1-sticky"
            counter={items === undefined ? undefined : counterText(items.length, listing.openEnd)}
            description={NAME_FILTER_DESCRIPTION}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" loading={listing.loading} onClick={refresh} />
                <Button
                  disabled={deleteReason !== undefined}
                  disabledReason={deleteReason}
                  onClick={() => {
                    if (selected !== undefined && deleteReason === undefined) {
                      setDeleting({ id: selected.id, label: nameOrId(selected.id, selected.tags) });
                    }
                  }}
                >
                  Delete
                </Button>
                <Button variant="primary" href={CREATE_ROUTE_TABLE_PATH} onFollow={handleFollow}>
                  {CREATE_ROUTE_TABLE_TITLE}
                </Button>
              </SpaceBetween>
            }
          >
            {ROUTE_TABLES_TITLE}
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
      <DeleteRouteTableDialog
        table={deleting}
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
