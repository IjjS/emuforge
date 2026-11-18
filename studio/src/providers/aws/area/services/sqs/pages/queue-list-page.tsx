import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import CollectionPreferences, {
  type CollectionPreferencesProps,
} from '@cloudscape-design/components/collection-preferences';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import TextFilter, { type TextFilterProps } from '@cloudscape-design/components/text-filter';
import { useCallback, useRef, useState, type ReactNode } from 'react';

import { useAreaModalRoot } from '../../../components/area-modal';
import type { AreaConnection } from '../../../components/emulator-line';
import { readFailureState, ReadFailure, useAnnouncer, type ReadFailureState } from '../../../components/failure-states';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { QueueRow } from '../api';
import { NONE, queuePath, queueSettings, queueType, type QueueSettings } from '../format';
import { useQueueListing, type QueueListing } from '../queries';

// SQS's queue list, S1 (issue 481, design task 1): every queue of the emulator, a page at a time on `ListQueues`' own
// tokens, each row with its type, its three counts and its dead-letter links, read with the page. Every value from the
// emulator is rendered as text, each as the kind of value it is (`aws-area.md`, entry 4).

/** The page's title, its `h1` and its crumb. */
export const QUEUES_TITLE = 'Queues';

/** The `h1`'s description (requirement, "EmuForge's own text"). */
const DESCRIPTION = 'Message counts are as of the last refresh.';

const FILTER_LABEL = 'Search by name prefix';
const FILTER_RULE = 'Matches the start of a name, upper and lower case told apart.';
const REFRESHED = 'Queue list refreshed';
const READING = 'Reading the queues';
const GONE = 'No longer in the emulator';

/** A queue's name keeps room for 24 characters (`aws-area.md`, entry 4). */
const NAME_MIN_WIDTH = '28ch';

/** The page size and "Wrap lines" at the start of every visit; stored nowhere. */
const START_PREFERENCES = { pageSize: 10, wrapLines: true };

const PAGE_SIZES = [10, 25, 50] as const;

/** What the table's body shows, the rows aside. */
type BodyState =
  | { kind: 'loading' }
  | { kind: 'rows' }
  | { kind: 'empty' }
  | { kind: 'no-match'; prefix: string }
  | { kind: 'failure'; failure: ReadFailureState };

function bodyState(listing: QueueListing, connection: AreaConnection): BodyState {
  if (listing.failure !== undefined) {
    return { kind: 'failure', failure: readFailureState(listing.failure, connection, 'queue list') };
  }
  if (listing.queues === undefined) {
    return { kind: 'loading' };
  }
  if (listing.queues.length > 0) {
    return { kind: 'rows' };
  }
  return listing.prefix === '' ? { kind: 'empty' } : { kind: 'no-match', prefix: listing.prefix };
}

/** The control whose use started the listing being read: it stays enabled, so it keeps focus. */
type Starter = 'filter' | 'pagination' | 'preferences' | null;

interface TableBodyProps {
  state: BodyState;
  onClearFilter: () => void;
  onRetry: () => void;
}

/** The table's empty slot: the empty, no-match and failure states, with Cloudscape's empty-table pattern. */
function TableBody({ state, onClearFilter, onRetry }: TableBodyProps) {
  switch (state.kind) {
    case 'loading':
    case 'rows':
      return null;
    case 'empty':
      return (
        <Box textAlign="center" color="inherit">
          <SpaceBetween size="xxs">
            <Box variant="strong" color="inherit">
              No queues
            </Box>
            <Box variant="p" color="inherit">
              This emulator holds no queues. Queues your app or any tool pointed at the emulator creates appear here. It
              starts empty each time it restarts.
            </Box>
          </SpaceBetween>
        </Box>
      );
    case 'no-match':
      return (
        <Box textAlign="center" color="inherit">
          <SpaceBetween size="xxs">
            <Box variant="strong" color="inherit">
              No matches
            </Box>
            <Box variant="p" color="inherit">
              <ValueText kind="text" value="No queue name starts with “" />
              <ValueText kind="name" value={state.prefix} />
              <ValueText kind="text" value="”." />
            </Box>
          </SpaceBetween>
          <Box margin={{ top: 's' }}>
            <Button onClick={onClearFilter}>Clear filter</Button>
          </Box>
        </Box>
      );
    case 'failure':
      return <ReadFailure state={state.failure} onRetry={onRetry} />;
  }
}

/** A row as the table shows it: its settings once read, or the status that stands in their place. */
interface Row {
  url: string;
  name: string;
  read?: { settings: QueueSettings; sources: string[] };
  status?: string;
}

function rowOf(queue: QueueRow, connection: AreaConnection): Row {
  const { url, name, details } = queue;
  switch (details.kind) {
    case 'read':
      return { url, name, read: { settings: queueSettings(details.attributes), sources: details.sources } };
    case 'gone':
      return { url, name, status: GONE };
    case 'failed':
      return { url, name, status: readFailureState(details.failure, connection, 'queue').firstText };
  }
}

function count(value: number | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

/** The header's counter: the page's rows, with a plus while a next page follows ("(10+)"). */
function counterText(rows: number, openEnd: boolean): string {
  return `(${String(rows)}${openEnd ? '+' : ''})`;
}

/** The label of the warning on the Available count of a dead-letter queue that holds messages. */
const DEAD_LETTERS = 'Dead letters waiting';

/**
 * A queue's Available count; on a dead-letter queue of at least one source that holds messages, a warning, so dead
 * letters stand out from the counts of any other queue.
 */
function AvailableCount({ settings, deadLetters }: { settings: QueueSettings; deadLetters: boolean }) {
  const available = settings.available;
  if (deadLetters && available !== undefined && available > 0) {
    return (
      <StatusIndicator type="warning" iconAriaLabel={DEAD_LETTERS}>
        <ValueText kind="fixed" value={String(available)} />
      </StatusIndicator>
    );
  }
  return <ValueText kind="fixed" value={count(available)} none={NONE} />;
}

/**
 * `/aws/sqs` and `/aws/sqs/queues`: the emulator's queues, read through the engine on every opening, refresh, search
 * and page. The table keeps its heading, controls and columns in every state and shows the state in its body. A
 * failed read, or a list shown while the connection was not connected, is read again by itself once the connection
 * is connected again (requirement, "States": after an emulator restart the list shows the empty emulator).
 */
export function QueueListPage({ connection }: { connection: AreaConnection }) {
  useShowsResources('queues');
  const handleFollow = useFollow();
  const modalRoot = useAreaModalRoot();
  const [announcement, announce] = useAnnouncer();
  const filterRef = useRef<TextFilterProps.Ref>(null);

  const [filter, setFilter] = useState('');
  const [preferences, setPreferences] = useState(START_PREFERENCES);
  const [starter, setStarter] = useState<Starter>(null);
  const listing = useQueueListing({ endpoint: connection.engineOrigin, pageSize: preferences.pageSize, filter });
  const { queues, refresh } = listing;
  const loaded = queues !== undefined && !listing.loading;
  const state = bodyState(listing, connection);
  const reading = listing.loading;

  const startListing = useCallback(() => {
    setStarter(null);
    refresh();
  }, [refresh]);

  // "Retry" reads the page that failed again, with the token it was asked with.
  const { currentPage, goToPage } = listing;
  const handleRetry = useCallback(() => {
    setStarter(null);
    goToPage(currentPage);
  }, [goToPage, currentPage]);

  // Kept from the previous render, as React's own pattern for it: what was last seen of the listing and the
  // connection, so each change is acted on once, in the render that first shows it.
  if (loaded && starter !== null) {
    setStarter(null);
  }
  const [refreshing, setRefreshing] = useState(false);
  const failureLine = state.kind === 'failure' ? state.failure.firstText : undefined;
  const [seenFailureLine, setSeenFailureLine] = useState<string>();
  const connected = connection.result?.kind === 'connected';
  const [seenConnected, setSeenConnected] = useState(connected);
  const down = connection.result !== undefined && !connected;
  const [wasDown, setWasDown] = useState(down);
  if (down && !wasDown) {
    setWasDown(true);
  }
  if (refreshing && loaded) {
    setRefreshing(false);
    announce(REFRESHED);
  } else if (refreshing && listing.failure !== undefined) {
    setRefreshing(false);
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
      startListing();
    }
  }

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    startListing();
  }, [startListing]);

  const handleFilterChange = useCallback(({ detail }: { detail: TextFilterProps.ChangeDetail }) => {
    setStarter('filter');
    setFilter(detail.filteringText);
  }, []);

  const handleClearFilter = useCallback(() => {
    setStarter('filter');
    setFilter('');
    filterRef.current?.focus();
  }, []);

  const handlePageChange = useCallback(
    ({ detail }: { detail: { currentPageIndex: number } }) => {
      setStarter('pagination');
      goToPage(detail.currentPageIndex);
    },
    [goToPage],
  );

  const handlePreferences = useCallback(
    ({ detail }: { detail: CollectionPreferencesProps.Preferences }) => {
      const pageSize = detail.pageSize ?? preferences.pageSize;
      if (pageSize !== preferences.pageSize) {
        setStarter('preferences');
      }
      setPreferences({ pageSize, wrapLines: detail.wrapLines ?? preferences.wrapLines });
    },
    [preferences],
  );

  const queueLink = (name: string): ReactNode => (
    <Link href={queuePath(name)} onFollow={handleFollow}>
      <ValueText kind="name" value={name} />
    </Link>
  );

  /** A cell of a row whose reads failed is empty: the row's status, in "Available", stands in their place. */
  const value = (row: Row, cell: (read: NonNullable<Row['read']>) => ReactNode): ReactNode =>
    row.read === undefined ? null : cell(row.read);

  const columns: TableProps.ColumnDefinition<Row>[] = [
    {
      id: 'name',
      header: 'Name',
      isRowHeader: true,
      minWidth: NAME_MIN_WIDTH,
      cell: (row) => queueLink(row.name),
    },
    {
      id: 'available',
      header: 'Available',
      cell: (row) =>
        row.read === undefined ? (
          <StatusIndicator type="error">
            <ValueText kind="text" value={row.status} />
          </StatusIndicator>
        ) : (
          <AvailableCount settings={row.read.settings} deadLetters={row.read.sources.length > 0} />
        ),
    },
    {
      id: 'inFlight',
      header: 'In flight',
      cell: (row) =>
        value(row, ({ settings }) => <ValueText kind="fixed" value={count(settings.inFlight)} none={NONE} />),
    },
    {
      id: 'delayed',
      header: 'Delayed',
      cell: (row) =>
        value(row, ({ settings }) => <ValueText kind="fixed" value={count(settings.delayed)} none={NONE} />),
    },
    {
      id: 'type',
      header: 'Type',
      cell: (row) => value(row, ({ settings }) => <ValueText kind="fixed" value={queueType(settings)} />),
    },
    {
      id: 'deadLetterQueue',
      header: 'Dead-letter queue',
      cell: (row) =>
        value(row, ({ settings }) =>
          settings.redrivePolicy === undefined ? NONE : queueLink(settings.redrivePolicy.deadLetterQueue),
        ),
    },
    {
      id: 'deadLetterQueueFor',
      header: 'Dead-letter queue for',
      cell: (row) =>
        value(row, ({ sources }) =>
          sources.length === 0 ? (
            NONE
          ) : (
            <SpaceBetween size="xxxs">
              {sources.map((source) => (
                <div key={source}>{queueLink(source)}</div>
              ))}
            </SpaceBetween>
          ),
        ),
    },
  ];

  const rows = (queues ?? []).map((queue) => rowOf(queue, connection));

  return (
    <>
      <Table<Row>
        variant="full-page"
        items={rows}
        trackBy="url"
        stickyColumns={{ first: 1 }}
        columnDefinitions={columns}
        wrapLines={preferences.wrapLines}
        loading={state.kind === 'loading'}
        loadingText="Loading queues"
        empty={<TableBody state={state} onClearFilter={handleClearFilter} onRetry={handleRetry} />}
        header={
          <Header
            variant="awsui-h1-sticky"
            counter={queues === undefined ? undefined : counterText(queues.length, listing.openEnd)}
            description={DESCRIPTION}
            actions={
              <Button
                iconName="refresh"
                ariaLabel="Refresh"
                disabled={reading}
                disabledReason={READING}
                onClick={handleRefresh}
              />
            }
          >
            {QUEUES_TITLE}
          </Header>
        }
        filter={
          <FormField constraintText={FILTER_RULE} stretch>
            <TextFilter
              ref={filterRef}
              filteringText={filter}
              filteringPlaceholder={FILTER_LABEL}
              filteringAriaLabel={FILTER_LABEL}
              disabled={!loaded && starter !== 'filter'}
              onChange={handleFilterChange}
            />
          </FormField>
        }
        pagination={
          <Pagination
            currentPageIndex={listing.currentPage}
            pagesCount={listing.pagesCount}
            openEnd={listing.openEnd}
            disabled={!loaded && starter !== 'pagination'}
            ariaLabels={{
              nextPageLabel: 'Next page',
              previousPageLabel: 'Previous page',
              pageLabel: (page) => `Page ${String(page)}`,
            }}
            onChange={handlePageChange}
          />
        }
        preferences={
          <CollectionPreferences
            {...modalRoot}
            title="Preferences"
            confirmLabel="Confirm"
            cancelLabel="Cancel"
            closeAriaLabel="Close modal"
            disabled={!loaded && starter !== 'preferences'}
            preferences={preferences}
            pageSizePreference={{
              title: 'Page size',
              options: PAGE_SIZES.map((size) => ({ value: size, label: `${String(size)} queues` })),
            }}
            wrapLinesPreference={{ label: 'Wrap lines', description: 'Show all of a long queue name' }}
            onConfirm={handlePreferences}
          />
        }
      />
      {announcement}
    </>
  );
}
