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
import type { Vpc } from '../api';
import { DeleteVpcDialog, type VpcTarget } from '../components/delete-vpc-dialog';
import {
  CREATE_VPC_PATH,
  CREATE_VPC_TITLE,
  ID_MIN_WIDTH,
  NAME_FILTER_DESCRIPTION,
  nameOrId,
  NONE,
  resourceName,
  vpcHref,
  VPCS_TITLE,
  VPCS_WORD,
} from '../format';
import { useVpcListing } from '../queries';

// The VPCs, S1 (issue 574, design task 1 and 2): every VPC of the emulator, a page of `DescribeVpcs` at a time on its
// own tokens, in the API's order. The name filter is the API's, `tag:Name` with `*` around it, sent once the text has
// settled, and part of the page's request. A further page that comes back empty is shown as the list's end. For the
// one selected VPC, "Delete".

const SELECT_ONE = 'Select one VPC.';

/** A name keeps room for 24 characters (`aws-area.md`, entry 4): 28ch is those 24 and the cell's padding on each side. */
const NAME_MIN_WIDTH = '28ch';

type BodyState =
  | { kind: 'loading' }
  | { kind: 'rows' }
  | { kind: 'empty' }
  | { kind: 'no-match' }
  | { kind: 'past-end' }
  | { kind: 'failure'; failure: ReadFailureState };

function bodyState(listing: TokenListing<Vpc>, connection: AreaConnection, filtered: boolean): BodyState {
  if (listing.failure !== undefined) {
    return { kind: 'failure', failure: readFailureState(listing.failure, connection, 'VPC list') };
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
 * `/aws/vpc` and `/aws/vpc/vpcs`. A failed read, or a list shown while the connection was not connected, is read again
 * by itself once the connection is connected again, so after an emulator restart it shows the default VPC alone.
 */
export function VpcListPage({ connection }: { connection: AreaConnection }) {
  useShowsResources(VPCS_WORD);
  const handleFollow = useFollow();
  const flash = usePageFlash();
  const [announcement, announce] = useAnnouncer();
  const [nameText, setNameText] = useState('');
  const [name, setName] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [deleting, setDeleting] = useState<VpcTarget>();

  const listing = useVpcListing(connection.engineOrigin, name);
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

  const handleDeleted = (vpc: VpcTarget) => {
    setDeleting(undefined);
    setSelectedId(undefined);
    flash.show([{ type: 'success', content: `Deleted VPC ${vpc.label}` }]);
  };

  const columns: TableProps.ColumnDefinition<Vpc>[] = [
    {
      id: 'name',
      header: 'Name',
      minWidth: NAME_MIN_WIDTH,
      cell: (row) => <NameText name={resourceName(row.tags)} />,
    },
    {
      id: 'id',
      header: 'VPC ID',
      isRowHeader: true,
      minWidth: ID_MIN_WIDTH,
      cell: (row) => (
        <Link href={vpcHref(row.id)} onFollow={handleFollow}>
          <ValueText kind="name" value={row.id} />
        </Link>
      ),
    },
    { id: 'state', header: 'State', cell: (row) => <ValueText kind="fixed" value={row.state} none={NONE} /> },
    { id: 'cidr', header: 'IPv4 CIDR', cell: (row) => <ValueText kind="fixed" value={row.cidr} none={NONE} /> },
    {
      id: 'default',
      header: 'Default',
      cell: (row) => <ValueText kind="fixed" value={row.isDefault ? 'Yes' : 'No'} />,
    },
  ];

  let empty = null;
  if (state.kind === 'empty') {
    empty = (
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            No VPCs
          </Box>
          <Box variant="p" color="inherit">
            The emulator holds no VPC.
          </Box>
        </SpaceBetween>
        <Box margin={{ top: 's' }}>
          <Button href={CREATE_VPC_PATH} onFollow={handleFollow}>
            {CREATE_VPC_TITLE}
          </Button>
        </Box>
      </Box>
    );
  } else if (state.kind === 'no-match') {
    empty = (
      <Box textAlign="center" color="inherit">
        <Box variant="strong" color="inherit">
          No VPCs match
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
          No more VPCs
        </Box>
      </Box>
    );
  } else if (state.kind === 'failure') {
    empty = <ReadFailure state={state.failure} onRetry={handleRetry} />;
  }

  return (
    <>
      <Table<Vpc>
        variant="full-page"
        items={rows}
        trackBy="id"
        selectionType="single"
        selectedItems={selected === undefined ? [] : [selected]}
        onSelectionChange={({ detail }) => {
          setSelectedId(detail.selectedItems[0]?.id);
        }}
        ariaLabels={{
          selectionGroupLabel: 'VPC selection',
          itemSelectionLabel: (_, row) => nameIdentity(nameOrId(row.id, row.tags)),
        }}
        columnDefinitions={columns}
        wrapLines
        loading={state.kind === 'loading'}
        loadingText="Loading VPCs"
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
                <Button variant="primary" href={CREATE_VPC_PATH} onFollow={handleFollow}>
                  {CREATE_VPC_TITLE}
                </Button>
              </SpaceBetween>
            }
          >
            {VPCS_TITLE}
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
      <DeleteVpcDialog
        vpc={deleting}
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
