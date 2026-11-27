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
import type { Subnet } from '../api';
import { DeleteSubnetDialog, type SubnetTarget } from '../components/delete-subnet-dialog';
import {
  CREATE_SUBNET_TITLE,
  createSubnetHref,
  ID_MIN_WIDTH,
  NAME_FILTER_DESCRIPTION,
  nameOrId,
  NONE,
  resourceName,
  subnetHref,
  SUBNETS_TITLE,
  SUBNETS_WORD,
  vpcHref,
} from '../format';
import { useSubnetListing } from '../queries';

// The subnets, S4 (issue 574, design task 1 and 2): every subnet of the emulator, a page of `DescribeSubnets` at a time
// on its own tokens, in the API's order. The name filter is the API's, `tag:Name` with `*` around it, sent once the text has
// settled, and part of the page's request. A further page that comes back empty is shown as the list's end. For the
// one selected subnet, "Delete".

const SELECT_ONE = 'Select one subnet.';

/** A name keeps room for 24 characters (`aws-area.md`, entry 4): 28ch is those 24 and the cell's padding on each side. */
const NAME_MIN_WIDTH = '28ch';

type BodyState =
  | { kind: 'loading' }
  | { kind: 'rows' }
  | { kind: 'empty' }
  | { kind: 'no-match' }
  | { kind: 'past-end' }
  | { kind: 'failure'; failure: ReadFailureState };

function bodyState(listing: TokenListing<Subnet>, connection: AreaConnection, filtered: boolean): BodyState {
  if (listing.failure !== undefined) {
    return { kind: 'failure', failure: readFailureState(listing.failure, connection, 'subnet list') };
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

/** The header's counter: the page's rows, with a plus while a next page follows ("(50+)"). */
function counterText(rows: number, openEnd: boolean): string {
  return `(${String(rows)}${openEnd ? '+' : ''})`;
}

/**
 * `/aws/vpc/subnets`. A failed read, or a list shown while the connection was not connected, is read again by itself
 * once the connection is connected again, so after an emulator restart it shows the default subnets alone.
 */
export function SubnetListPage({ connection }: { connection: AreaConnection }) {
  useShowsResources(SUBNETS_WORD);
  const handleFollow = useFollow();
  const flash = usePageFlash();
  const [announcement, announce] = useAnnouncer();
  const [nameText, setNameText] = useState('');
  const [name, setName] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [deleting, setDeleting] = useState<SubnetTarget>();

  const listing = useSubnetListing(connection.engineOrigin, { name });
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
  const deleteReason = selected === undefined ? SELECT_ONE : undefined;

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

  const handleDeleted = (subnet: SubnetTarget) => {
    setDeleting(undefined);
    setSelectedId(undefined);
    flash.show([{ type: 'success', content: `Deleted subnet ${subnet.label}` }]);
  };

  const columns: TableProps.ColumnDefinition<Subnet>[] = [
    {
      id: 'name',
      header: 'Name',
      minWidth: NAME_MIN_WIDTH,
      cell: (row) => <NameText name={resourceName(row.tags)} none={NONE} />,
    },
    {
      id: 'id',
      header: 'Subnet ID',
      isRowHeader: true,
      minWidth: ID_MIN_WIDTH,
      cell: (row) => (
        <Link href={subnetHref(row.id)} onFollow={handleFollow}>
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
    { id: 'cidr', header: 'IPv4 CIDR', cell: (row) => <ValueText kind="fixed" value={row.cidr} none={NONE} /> },
    { id: 'zone', header: 'Availability Zone', cell: (row) => <ValueText kind="fixed" value={row.zone} none={NONE} /> },
    {
      id: 'free',
      header: 'Free IPv4 addresses',
      cell: (row) => (
        <ValueText
          kind="fixed"
          value={row.freeAddresses === undefined ? undefined : String(row.freeAddresses)}
          none={NONE}
        />
      ),
    },
  ];

  let empty = null;
  if (state.kind === 'empty') {
    empty = (
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            No subnets
          </Box>
          <Box variant="p" color="inherit">
            The emulator holds no subnet.
          </Box>
        </SpaceBetween>
        <Box margin={{ top: 's' }}>
          <Button href={createSubnetHref()} onFollow={handleFollow}>
            {CREATE_SUBNET_TITLE}
          </Button>
        </Box>
      </Box>
    );
  } else if (state.kind === 'no-match') {
    empty = (
      <Box textAlign="center" color="inherit">
        <Box variant="strong" color="inherit">
          No subnets match
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
          No more subnets
        </Box>
      </Box>
    );
  } else if (state.kind === 'failure') {
    empty = <ReadFailure state={state.failure} onRetry={handleRetry} />;
  }

  return (
    <>
      <Table<Subnet>
        variant="full-page"
        items={rows}
        trackBy="id"
        selectionType="single"
        selectedItems={selected === undefined ? [] : [selected]}
        onSelectionChange={({ detail }) => {
          setSelectedId(detail.selectedItems[0]?.id);
        }}
        ariaLabels={{
          selectionGroupLabel: 'Subnet selection',
          itemSelectionLabel: (_, row) => nameIdentity(nameOrId(row.id, row.tags)),
        }}
        columnDefinitions={columns}
        wrapLines
        loading={state.kind === 'loading'}
        loadingText="Loading subnets"
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
                <Button variant="primary" href={createSubnetHref()} onFollow={handleFollow}>
                  {CREATE_SUBNET_TITLE}
                </Button>
              </SpaceBetween>
            }
          >
            {SUBNETS_TITLE}
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
      <DeleteSubnetDialog
        subnet={deleting}
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
