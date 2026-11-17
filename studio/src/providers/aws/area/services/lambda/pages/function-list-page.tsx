import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ButtonDropdown, { type ButtonDropdownProps } from '@cloudscape-design/components/button-dropdown';
import CollectionPreferences, {
  type CollectionPreferencesProps,
} from '@cloudscape-design/components/collection-preferences';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import PropertyFilter, { type PropertyFilterProps } from '@cloudscape-design/components/property-filter';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import type { AreaConnection } from '../../../components/emulator-line';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import type { FunctionSummary } from '../api';
import { DeleteFunctionsDialog } from '../components/delete-functions-dialog';
import { readFailureState, useAnnouncer, type ReadFailureState } from '../components/failure-states';
import { Code, ReadFailure } from '../components/failures';
import { useAreaModalRoot } from '../components/modal-root';
import { CREATE_FUNCTION_PATH, functionPath, lastModifiedText, runtimeText, typeText, valueText } from '../format';
import { useFunctionListing, type FunctionCount, type FunctionListing } from '../queries';

// Lambda's function list (issue 84, requirement R4, R6.1, R7 to R10): the console's "Event Functions" page in the
// console's words (`studio/references/console/lambda/function-list.yaml`); its description and states in EmuForge's
// own. Every value from the engine or the emulator is rendered as text.

/** The page's title, its `h1` (R6.1). */
export const FUNCTIONS_TITLE = 'Event Functions';

const FILTER_LABEL = 'Search by attributes or search by keyword';
const SELECT_FIRST = 'Select a function first';
const REFRESHED = 'Function list refreshed';
const NO_MORE = 'No more functions';

/** The page size and "Wrap lines" at the start of every visit (R4.8); stored nowhere. */
const START_PREFERENCES = { pageSize: 25, wrapLines: true };

const PAGE_SIZES = [10, 25, 50] as const;

/** No property: the filter takes free text only (R4.7). */
const NO_PROPERTIES: readonly PropertyFilterProps.FilteringProperty[] = [];

/** What the table's body shows (R10.1), the rows aside. */
type BodyState =
  | { kind: 'loading' }
  | { kind: 'rows' }
  | { kind: 'empty' }
  | { kind: 'no-match'; text: string }
  | { kind: 'failure'; failure: ReadFailureState };

function bodyState(listing: FunctionListing, filter: string, connection: AreaConnection): BodyState {
  if (listing.failure !== undefined) {
    return { kind: 'failure', failure: readFailureState(listing.failure, connection, 'function list') };
  }
  if (listing.functions === undefined) {
    return { kind: 'loading' };
  }
  if (listing.functions.length > 0) {
    return { kind: 'rows' };
  }
  return filter === '' ? { kind: 'empty' } : { kind: 'no-match', text: filter };
}

function countText(count: FunctionCount): string {
  return `${String(count.total)}${count.more ? '+' : ''}`;
}

/** "1 match", "2 matches", "25+ matches" (R4.7). */
function matchesText(count: FunctionCount): string {
  return count.total === 1 && !count.more ? '1 match' : `${countText(count)} matches`;
}

/** The filter's query: the one free-text token of the applied text, or none (R4.7). */
function filterQuery(filter: string): PropertyFilterProps.Query {
  return { tokens: filter === '' ? [] : [{ operator: ':', value: filter }], operation: 'and' };
}

/** The control whose use started the listing being read: it stays enabled, so it keeps focus (R10.1). */
type Starter = 'filter' | 'pagination' | 'preferences' | null;

interface TableBodyProps {
  state: BodyState;
  onCreate: () => void;
  onClearFilter: () => void;
  onRetry: () => void;
}

/** The table's empty slot: the empty, no-match and failure states (R10.1), with Cloudscape's empty-table pattern. */
function TableBody({ state, onCreate, onClearFilter, onRetry }: TableBodyProps) {
  switch (state.kind) {
    case 'loading':
    case 'rows':
      return null;
    case 'empty':
      return (
        <Box textAlign="center" color="inherit">
          <SpaceBetween size="xxs">
            <Box variant="strong" color="inherit">
              No functions
            </Box>
            <Box variant="p" color="inherit">
              This emulator holds no functions. It starts empty each time it restarts. Create one here, or with any tool
              pointed at the emulator.
            </Box>
          </SpaceBetween>
          <Box margin={{ top: 's' }}>
            <Button onClick={onCreate}>Create Event Function</Button>
          </Box>
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
              {`No function name starts with “${state.text}”.`}
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

/**
 * `/aws/lambda` and `/aws/lambda/functions`: the emulator's functions, read through the engine with `ListFunctions`
 * on every opening and refresh, one page at a time (requirement R4). The table keeps its heading, actions and columns
 * in every state and shows the state in its body (R10.1). A failed read is read again by itself once the connection
 * is connected again (R10.2, in the listing's hook).
 */
export function FunctionListPage({ connection }: { connection: AreaConnection }) {
  useShowsResources('functions');
  const handleFollow = useFollow();
  const navigate = useNavigate();
  const modalRoot = useAreaModalRoot();
  const [announcement, announce] = useAnnouncer();
  const actionsRef = useRef<ButtonDropdownProps.Ref>(null);

  const [filter, setFilter] = useState('');
  const [preferences, setPreferences] = useState(START_PREFERENCES);
  const [starter, setStarter] = useState<Starter>(null);
  const connected = connection.result?.kind === 'connected';
  const listing = useFunctionListing({
    endpoint: connection.engineOrigin,
    pageSize: preferences.pageSize,
    filter,
    connected,
  });
  const { functions, refresh } = listing;
  const loaded = functions !== undefined;
  const state = bodyState(listing, filter, connection);

  // Several rows, by name: a name stays selected while it is on the page shown (R4.3, R4.4).
  const [selectedNames, setSelectedNames] = useState<readonly string[]>([]);
  if (functions !== undefined) {
    const kept = selectedNames.filter((name) => functions.some((fn) => fn.name === name));
    if (kept.length !== selectedNames.length) {
      setSelectedNames(kept);
    }
  }
  const selected = (functions ?? []).filter((fn) => selectedNames.includes(fn.name));

  // The names "Delete functions" is open for; none while it is closed.
  const [deleting, setDeleting] = useState<readonly string[]>([]);

  const startListing = useCallback(() => {
    setStarter(null);
    refresh();
  }, [refresh]);

  // "Retry" reads the page that failed again, with the marker it was asked with: it starts no new listing (R10.2).
  const { currentPage, goToPage } = listing;
  const handleRetry = useCallback(() => {
    setStarter(null);
    goToPage(currentPage);
  }, [goToPage, currentPage]);

  // A loaded listing ends what its control started; a later listing no control starts (after a delete, or the re-read
  // after a reconnect) keeps every control disabled until it is loaded (R10.1).
  if (loaded && starter !== null) {
    setStarter(null);
  }

  // Kept from the previous render, as React's own pattern for it: what was last seen of the listing, so each change
  // is acted on once, in the render that first shows it.
  const [refreshing, setRefreshing] = useState(false);
  const failureLine = state.kind === 'failure' ? state.failure.firstText : undefined;
  const [seenFailureLine, setSeenFailureLine] = useState<string>();
  const [seenNoMore, setSeenNoMore] = useState(listing.noMoreCount);
  // "Function list refreshed", once the refreshed listing's first page is shown (R8).
  if (refreshing && loaded) {
    setRefreshing(false);
    announce(REFRESHED);
  } else if (refreshing && listing.failure !== undefined) {
    setRefreshing(false);
  }
  // A failure state is announced once, with its first line (R10.2).
  if (failureLine !== seenFailureLine) {
    setSeenFailureLine(failureLine);
    if (failureLine !== undefined) {
      announce(failureLine);
    }
  }
  // A later page that came back with no function to show (R4.4).
  if (listing.noMoreCount !== seenNoMore) {
    setSeenNoMore(listing.noMoreCount);
    if (listing.noMoreCount > seenNoMore) {
      announce(NO_MORE);
    }
  }

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    startListing();
  }, [startListing]);

  const handleFilterChange = useCallback(({ detail }: { detail: PropertyFilterProps.Query }) => {
    // The token applied last takes the place of the one before: the filter never holds two (R4.7).
    const last = detail.tokens.at(-1);
    const value = last === undefined ? '' : String(last.value ?? '');
    setStarter('filter');
    setFilter(value);
  }, []);

  const handleClearFilter = useCallback(() => {
    setStarter('filter');
    setFilter('');
  }, []);

  const handlePageChange = useCallback(
    ({ detail }: { detail: { currentPageIndex: number } }) => {
      setStarter('pagination');
      listing.goToPage(detail.currentPageIndex);
    },
    [listing],
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

  const handleSelection = useCallback(({ detail }: { detail: TableProps.SelectionChangeDetail<FunctionSummary> }) => {
    setSelectedNames(detail.selectedItems.map((fn) => fn.name));
  }, []);

  const handleAction = useCallback(
    ({ detail }: { detail: ButtonDropdownProps.ItemClickDetails }) => {
      if (detail.id === 'delete' && selected.length > 0) {
        setDeleting(selected.map((fn) => fn.name));
      }
    },
    [selected],
  );

  const handleDialogClose = useCallback(() => {
    setDeleting([]);
    // Focus returns to what opened the dialog (R7).
    actionsRef.current?.focus();
  }, []);

  const handleCreate = useCallback(() => {
    void navigate(CREATE_FUNCTION_PATH);
  }, [navigate]);

  const result = connection.result;
  const description =
    result?.kind === 'connected' ? (
      <>
        Functions in your local emulator at <Code>{result.emulator.endpoint}</Code>, not in an AWS account. The filter
        matches the start of a name, upper and lower case told apart.
      </>
    ) : (
      'Functions in your local emulator, not in an AWS account. The filter matches the start of a name, upper and lower case told apart.'
    );

  const columns: TableProps.ColumnDefinition<FunctionSummary>[] = [
    {
      id: 'name',
      header: 'Function name',
      isRowHeader: true,
      cell: (fn) => (
        <Link href={functionPath(fn.name)} onFollow={handleFollow}>
          {fn.name}
        </Link>
      ),
    },
    { id: 'description', header: 'Description', cell: (fn) => valueText(fn.description) },
    { id: 'packageType', header: 'Package type', cell: (fn) => valueText(fn.packageType) },
    { id: 'runtime', header: 'Runtime', cell: (fn) => runtimeText(fn.runtime) },
    { id: 'type', header: 'Type', cell: (fn) => typeText(fn.durable) },
    { id: 'lastModified', header: 'Last modified', cell: (fn) => lastModifiedText(fn.lastModified) },
  ];

  const count = loaded ? listing.count : undefined;

  return (
    <>
      <Table<FunctionSummary>
        variant="full-page"
        items={functions ?? []}
        trackBy="name"
        columnDefinitions={columns}
        selectionType="multi"
        selectedItems={selected}
        onSelectionChange={handleSelection}
        ariaLabels={{
          selectionGroupLabel: 'Function selection',
          allItemsSelectionLabel: () => 'Select all items',
          itemSelectionLabel: (_, fn) => fn.name,
        }}
        wrapLines={preferences.wrapLines}
        loading={state.kind === 'loading'}
        loadingText="Loading functions"
        empty={
          <TableBody state={state} onCreate={handleCreate} onClearFilter={handleClearFilter} onRetry={handleRetry} />
        }
        header={
          <Header
            variant="awsui-h1-sticky"
            counter={count === undefined ? undefined : `(${countText(count)})`}
            description={description}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={handleRefresh} />
                <ButtonDropdown
                  ref={actionsRef}
                  items={[{ id: 'delete', text: 'Delete' }]}
                  disabled={selected.length === 0}
                  disabledReason={SELECT_FIRST}
                  onItemClick={handleAction}
                >
                  Actions
                </ButtonDropdown>
                <Button variant="primary" onClick={handleCreate}>
                  Create Event Function
                </Button>
              </SpaceBetween>
            }
          >
            {FUNCTIONS_TITLE}
          </Header>
        }
        filter={
          <PropertyFilter
            query={filterQuery(filter)}
            onChange={handleFilterChange}
            filteringProperties={NO_PROPERTIES}
            hideOperations
            filteringPlaceholder={FILTER_LABEL}
            filteringAriaLabel={FILTER_LABEL}
            disabled={!loaded && starter !== 'filter'}
            {...(filter !== '' && count !== undefined && { countText: matchesText(count) })}
          />
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
            // The dismiss control has its own name, as in the console; Cloudscape would name it "Cancel" too.
            closeAriaLabel="Close modal"
            disabled={!loaded && starter !== 'preferences'}
            preferences={preferences}
            pageSizePreference={{
              title: 'Page size',
              options: PAGE_SIZES.map((size) => ({ value: size, label: `${String(size)} functions` })),
            }}
            wrapLinesPreference={{ label: 'Wrap lines', description: 'Show all of a long description' }}
            onConfirm={handlePreferences}
          />
        }
      />
      <DeleteFunctionsDialog names={deleting} connection={connection} onClose={handleDialogClose} />
      {announcement}
    </>
  );
}
