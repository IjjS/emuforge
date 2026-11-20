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
import { ValueText } from '../../../components/value-text';
import { DeleteGroupDialog, type GroupTarget } from '../components/delete-group-dialog';
import {
  CREATE_SECURITY_GROUP_PATH,
  CREATE_SECURITY_GROUP_TITLE,
  NONE,
  securityGroupHref,
  SECURITY_GROUPS_TITLE,
  SECURITY_GROUPS_WORD,
} from '../format';
import type { SecurityGroup } from '../group-api';
import { DEFAULT_GROUP_NAME } from '../group-format';
import { useGroupListing } from '../group-queries';

// The security groups, S4 (issue 553, design task 4): every group of the emulator, a page of `DescribeSecurityGroups`
// at a time on its own tokens, in the API's order. The name filter is the API's, `group-name` with `*` around it,
// sent once the text has settled. The emulator gives a token with the last group, so a further page can come back
// empty: it is shown as the list's end. For the one selected group, "Delete".

const SELECT_ONE = 'Select one security group.';
const DEFAULT_REASON = 'The default security group cannot be deleted.';

/** A name keeps room for 24 characters (`aws-area.md`, entry 4): 28ch is those 24 and the cell's padding on each side. */
const NAME_MIN_WIDTH = '28ch';

type BodyState =
  | { kind: 'loading' }
  | { kind: 'rows' }
  | { kind: 'empty' }
  | { kind: 'no-match' }
  | { kind: 'past-end' }
  | { kind: 'failure'; failure: ReadFailureState };

function bodyState(listing: TokenListing<SecurityGroup>, connection: AreaConnection, filtered: boolean): BodyState {
  if (listing.failure !== undefined) {
    return { kind: 'failure', failure: readFailureState(listing.failure, connection, 'security group list') };
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
 * `/aws/ec2/security-groups`. A failed read, or a list shown while the connection was not connected, is read again by
 * itself once the connection is connected again, so after an emulator restart it shows the group `default` alone.
 */
export function GroupListPage({ connection }: { connection: AreaConnection }) {
  useShowsResources(SECURITY_GROUPS_WORD);
  const handleFollow = useFollow();
  const flash = usePageFlash();
  const [announcement, announce] = useAnnouncer();
  const [nameText, setNameText] = useState('');
  const [name, setName] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [deleting, setDeleting] = useState<GroupTarget>();

  const listing = useGroupListing(connection.engineOrigin, name);
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
  const deleteReason =
    selected === undefined ? SELECT_ONE : selected.name === DEFAULT_GROUP_NAME ? DEFAULT_REASON : undefined;

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

  const handleDeleted = (group: GroupTarget) => {
    setDeleting(undefined);
    setSelectedId(undefined);
    flash.show([{ type: 'success', content: `Deleted security group ${group.name}` }]);
  };

  const columns: TableProps.ColumnDefinition<SecurityGroup>[] = [
    {
      id: 'name',
      header: 'Name',
      isRowHeader: true,
      minWidth: NAME_MIN_WIDTH,
      cell: (row) => (
        <Link href={securityGroupHref(row.id)} onFollow={handleFollow}>
          <ValueText kind="name" value={row.name} none={row.id} />
        </Link>
      ),
    },
    { id: 'id', header: 'Group ID', cell: (row) => <ValueText kind="name" value={row.id} /> },
    { id: 'vpc', header: 'VPC ID', cell: (row) => <ValueText kind="name" value={row.vpcId} none={NONE} /> },
    {
      id: 'description',
      header: 'Description',
      cell: (row) => <ValueText kind="text" value={row.description} none={NONE} />,
    },
  ];

  let empty = null;
  if (state.kind === 'empty') {
    empty = (
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            No security groups
          </Box>
          <Box variant="p" color="inherit">
            The emulator holds no security group.
          </Box>
        </SpaceBetween>
        <Box margin={{ top: 's' }}>
          <Button href={CREATE_SECURITY_GROUP_PATH} onFollow={handleFollow}>
            {CREATE_SECURITY_GROUP_TITLE}
          </Button>
        </Box>
      </Box>
    );
  } else if (state.kind === 'no-match') {
    empty = (
      <Box textAlign="center" color="inherit">
        <Box variant="strong" color="inherit">
          No security groups match
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
          No more security groups
        </Box>
      </Box>
    );
  } else if (state.kind === 'failure') {
    empty = <ReadFailure state={state.failure} onRetry={handleRetry} />;
  }

  return (
    <>
      <Table<SecurityGroup>
        variant="full-page"
        items={rows}
        trackBy="id"
        selectionType="single"
        selectedItems={selected === undefined ? [] : [selected]}
        onSelectionChange={({ detail }) => {
          setSelectedId(detail.selectedItems[0]?.id);
        }}
        ariaLabels={{
          selectionGroupLabel: 'Security group selection',
          itemSelectionLabel: (_, row) => (row.name === '' ? row.id : row.name),
        }}
        columnDefinitions={columns}
        wrapLines
        loading={state.kind === 'loading'}
        loadingText="Loading security groups"
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
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" loading={listing.loading} onClick={refresh} />
                <Button
                  disabled={deleteReason !== undefined}
                  disabledReason={deleteReason}
                  onClick={() => {
                    if (selected !== undefined && deleteReason === undefined) {
                      setDeleting({ id: selected.id, name: selected.name });
                    }
                  }}
                >
                  Delete
                </Button>
                <Button variant="primary" href={CREATE_SECURITY_GROUP_PATH} onFollow={handleFollow}>
                  {CREATE_SECURITY_GROUP_TITLE}
                </Button>
              </SpaceBetween>
            }
          >
            {SECURITY_GROUPS_TITLE}
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
      <DeleteGroupDialog
        group={deleting}
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
