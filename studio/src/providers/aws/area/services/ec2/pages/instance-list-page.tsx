import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import TextFilter from '@cloudscape-design/components/text-filter';
import { useCallback, useState } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import { readFailureState, ReadFailure, useAnnouncer, type ReadFailureState } from '../../../components/failure-states';
import { creationDateText } from '../../../components/format-date';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import type { TokenListing } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import type { Instance } from '../api';
import { InstanceActions } from '../components/instance-actions';
import { InstanceStateValue } from '../components/instance-state';
import {
  instanceHref,
  instanceName,
  INSTANCES_TITLE,
  INSTANCES_WORD,
  LAUNCH_INSTANCE_PATH,
  nameOf,
  NONE,
} from '../format';
import { INSTANCE_STATES } from '../instance-state';
import { useInstanceListing, type ListingFilters } from '../queries';

// The instances, S1 (issue 553, design tasks 1 and 3): every instance of the emulator, a page of `DescribeInstances`
// at a time on its own tokens, in the API's order, terminated ones included. Both filters are the API's: the state
// as `instance-state-name`, the name as `tag:Name` with `*` around it, sent once the text has settled. For the one
// selected row, the instance's actions.

// The last two words are held together so that at 390 no word stands alone on the last line (critique final P3 2).
const DESCRIPTION = 'The name filter matches the Name tag and is\u00a0case-sensitive.';
const ANY_STATE: SelectProps.Option = { value: '', label: 'Any state' };
const STATE_OPTIONS: SelectProps.Option[] = [
  ANY_STATE,
  ...INSTANCE_STATES.map((state) => ({ value: state, label: state })),
];
const NO_FILTERS: ListingFilters = { state: '', name: '' };

/** A name keeps room for 24 characters (`aws-area.md`, entry 4). */
const NAME_MIN_WIDTH = '28ch';

/**
 * Room for an instance's ID (`i-` and 17 hex digits) on one line, an IPv4 address whole, and a launch time on two
 * lines; past them the table scrolls inside itself (critique final P2 1).
 */
const ID_MIN_WIDTH = '23ch';
const ADDRESS_MIN_WIDTH = '18ch';
const LAUNCHED_MIN_WIDTH = '26ch';

type BodyState =
  | { kind: 'loading' }
  | { kind: 'rows' }
  | { kind: 'empty' }
  | { kind: 'no-match' }
  | { kind: 'failure'; failure: ReadFailureState };

function bodyState(listing: TokenListing<Instance>, connection: AreaConnection, filtered: boolean): BodyState {
  if (listing.failure !== undefined) {
    return { kind: 'failure', failure: readFailureState(listing.failure, connection, 'instance list') };
  }
  if (listing.items === undefined) {
    return { kind: 'loading' };
  }
  if (listing.items.length > 0) {
    return { kind: 'rows' };
  }
  return filtered ? { kind: 'no-match' } : { kind: 'empty' };
}

/** The header's counter: the page's rows, with a plus while a next page follows ("(50+)"). */
function counterText(rows: number, openEnd: boolean): string {
  return `(${String(rows)}${openEnd ? '+' : ''})`;
}

/** An IPv4 address, a fixed value never broken inside, or "-" without one. */
function Address({ value }: { value: string | undefined }) {
  return <ValueText kind="fixed" value={value} none={NONE} />;
}

/**
 * `/aws/ec2` and `/aws/ec2/instances`. A failed read, or a list shown while the connection was not connected, is read
 * again by itself once the connection is connected again, so after an emulator restart it shows the empty emulator.
 */
export function InstanceListPage({ connection }: { connection: AreaConnection }) {
  useShowsResources(INSTANCES_WORD);
  const handleFollow = useFollow();
  const [announcement, announce] = useAnnouncer();
  const [nameText, setNameText] = useState('');
  const [filters, setFilters] = useState<ListingFilters>(NO_FILTERS);
  const [selectedId, setSelectedId] = useState<string>();

  const listing = useInstanceListing(connection.engineOrigin, filters);
  const { items, refresh, currentPage, goToPage } = listing;
  const filtered = filters.state !== '' || filters.name !== '';
  const state = bodyState(listing, connection, filtered);
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

  const changeFilters = (next: ListingFilters) => {
    setSelectedId(undefined);
    setFilters(next);
  };

  const handleClearFilters = () => {
    setNameText('');
    changeFilters(NO_FILTERS);
  };

  const handlePageChange = ({ detail }: { detail: { currentPageIndex: number } }) => {
    setSelectedId(undefined);
    goToPage(detail.currentPageIndex);
  };

  const columns: TableProps.ColumnDefinition<Instance>[] = [
    {
      id: 'name',
      header: 'Name',
      minWidth: NAME_MIN_WIDTH,
      cell: (row) => <ValueText kind="name" value={instanceName(row.tags)} />,
    },
    {
      id: 'id',
      header: 'Instance ID',
      isRowHeader: true,
      minWidth: ID_MIN_WIDTH,
      cell: (row) => (
        <Link href={instanceHref(row.id)} onFollow={handleFollow}>
          <ValueText kind="name" value={row.id} />
        </Link>
      ),
    },
    { id: 'state', header: 'State', cell: (row) => <InstanceStateValue state={row.state} /> },
    { id: 'type', header: 'Type', cell: (row) => <ValueText kind="fixed" value={row.type} none={NONE} /> },
    { id: 'zone', header: 'Availability Zone', cell: (row) => <ValueText kind="fixed" value={row.zone} none={NONE} /> },
    {
      id: 'public',
      header: 'Public IPv4',
      minWidth: ADDRESS_MIN_WIDTH,
      cell: (row) => <Address value={row.publicIp} />,
    },
    {
      id: 'private',
      header: 'Private IPv4',
      minWidth: ADDRESS_MIN_WIDTH,
      cell: (row) => <Address value={row.privateIp} />,
    },
    {
      id: 'launched',
      header: 'Launched',
      minWidth: LAUNCHED_MIN_WIDTH,
      cell: (row) => <ValueText kind="fixed" value={creationDateText(row.launchTime)} />,
    },
  ];

  let empty = null;
  if (state.kind === 'empty') {
    empty = (
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            No instances
          </Box>
          <Box variant="p" color="inherit">
            The emulator holds no instance yet.
          </Box>
        </SpaceBetween>
        <Box margin={{ top: 's' }}>
          <Button href={LAUNCH_INSTANCE_PATH} onFollow={handleFollow}>
            Launch instance
          </Button>
        </Box>
      </Box>
    );
  } else if (state.kind === 'no-match') {
    empty = (
      <Box textAlign="center" color="inherit">
        <Box variant="strong" color="inherit">
          No instances match
        </Box>
        <Box margin={{ top: 's' }}>
          <Button onClick={handleClearFilters}>Clear filters</Button>
        </Box>
      </Box>
    );
  } else if (state.kind === 'failure') {
    empty = <ReadFailure state={state.failure} onRetry={handleRetry} />;
  }

  const stateOption = STATE_OPTIONS.find((option) => option.value === filters.state) ?? ANY_STATE;

  return (
    <>
      <Table<Instance>
        variant="full-page"
        items={rows}
        trackBy="id"
        selectionType="single"
        selectedItems={selected === undefined ? [] : [selected]}
        onSelectionChange={({ detail }) => {
          setSelectedId(detail.selectedItems[0]?.id);
        }}
        ariaLabels={{
          selectionGroupLabel: 'Instance selection',
          itemSelectionLabel: (_, row) => nameOf(row.tags) ?? row.id,
        }}
        columnDefinitions={columns}
        wrapLines
        loading={state.kind === 'loading'}
        loadingText="Loading instances"
        empty={empty}
        filter={
          <SpaceBetween direction="horizontal" size="xs">
            <TextFilter
              filteringText={nameText}
              filteringPlaceholder="Find by name"
              filteringAriaLabel="Name"
              filteringClearAriaLabel="Clear the name filter"
              onChange={({ detail }) => {
                setNameText(detail.filteringText);
              }}
              onDelayedChange={({ detail }) => {
                if (detail.filteringText !== filters.name) {
                  changeFilters({ ...filters, name: detail.filteringText });
                }
              }}
            />
            <Select
              selectedOption={stateOption}
              options={STATE_OPTIONS}
              inlineLabelText="State"
              onChange={({ detail }) => {
                changeFilters({ ...filters, state: detail.selectedOption.value ?? '' });
              }}
            />
          </SpaceBetween>
        }
        header={
          <Header
            variant="awsui-h1-sticky"
            counter={items === undefined ? undefined : counterText(items.length, listing.openEnd)}
            description={DESCRIPTION}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" loading={listing.loading} onClick={refresh} />
                <InstanceActions
                  instance={
                    selected === undefined
                      ? undefined
                      : { id: selected.id, state: selected.state, ...withName(selected) }
                  }
                  connection={connection}
                />
                <Button variant="primary" href={LAUNCH_INSTANCE_PATH} onFollow={handleFollow}>
                  Launch instance
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

function withName(instance: Instance): { name?: string } {
  const name = nameOf(instance.tags);
  return name === undefined ? {} : { name };
}
