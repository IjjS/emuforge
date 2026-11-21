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
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { useAreaModalRoot } from '../../../components/area-modal';
import type { AreaConnection } from '../../../components/emulator-line';
import { useShowsResources } from '../../../components/page-resources';
import { usePageFlash } from '../../../components/page-flash';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { DeleteResult, FunctionSummary } from '../api';
import { DeleteFunctionsDialog } from '../components/delete-functions-dialog';
import { readFailureState, useAnnouncer, type ReadFailureState } from '../components/failure-states';
import { ReadFailure } from '../components/failures';
import { quoting } from '../components/quoting';
import './function-list-page.css';
import { CREATE_FUNCTION_PATH, functionPath, lastModifiedText, NONE, runtimeText, typeText } from '../format';
import { useFunctionListing, type FunctionCount, type FunctionListing } from '../queries';

// Lambda's function list (issue 84, requirement R4, R6.1, R7 to R10): the console's "Event Functions" page in the
// console's words (`studio/references/console/lambda/function-list.yaml`); its description and states in EmuForge's
// own. Every value from the engine or the emulator is rendered as text, each cell as the kind of value it is (issue
// 467, requirement R6), with "Wrap lines" on or off.

/** The page's title, its `h1` (R6.1). */
export const FUNCTIONS_TITLE = 'Event Functions';

/** The `h1`'s description in every state of the connection: the filter's rule (issue 467, R3). */
const DESCRIPTION = 'The filter matches the start of a name and is case-sensitive.';

/**
 * The room a column keeps (issue 467, R6), in characters of the heading's text, the cell's padding included: a name's
 * column, so a name of up to 24 characters is on one line; "Runtime", so a runtime's name ("Node.js 24.x", "OS-only
 * Runtime") is; "Description", so a word of free text up to 10 characters is whole. A size; no spacing is set.
 */
const NAME_MIN_WIDTH = '28ch';
const RUNTIME_MIN_WIDTH = '18ch';

const FILTER_LABEL = 'Search by attributes or search by keyword';
const SELECT_FIRST = 'Select a function first';
const WAIT_FOR_LIST = 'Wait for the current function list to load.';
const EXPIRED_DRAFT =
  'The delete confirmation closed because the browser connection changed. After the current function list loads, reopen Delete from Actions and confirm again.';
const REFRESHED = 'Function list refreshed';
const NO_MORE = 'No more functions';

/** The page size and "Wrap lines" at the start of every visit (R4.8); stored nowhere. */
const START_PREFERENCES = { pageSize: 25, wrapLines: true };

const PAGE_SIZES = [10, 25, 50] as const;

/** No property: the filter takes free text only (R4.7). */
const NO_PROPERTIES: readonly PropertyFilterProps.FilteringProperty[] = [];

const NO_DELETE_TARGETS: readonly string[] = [];

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
              {quoting('No function name starts with “', state.text, '”.')}
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
  const flash = usePageFlash();
  const actionsRef = useRef<ButtonDropdownProps.Ref>(null);
  const connectionRevision = useRef(0);
  const [network, setNetwork] = useState(() => ({ online: navigator.onLine, revision: 0 }));

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
  useLayoutEffect(() => {
    const offline = () => {
      connectionRevision.current += 1;
      setNetwork({ online: false, revision: connectionRevision.current });
    };
    const online = () => {
      connectionRevision.current += 1;
      setNetwork({ online: true, revision: connectionRevision.current });
      refresh();
    };
    window.addEventListener('offline', offline, true);
    window.addEventListener('online', online, true);
    return () => {
      window.removeEventListener('offline', offline, true);
      window.removeEventListener('online', online, true);
    };
  }, [refresh]);

  // Several rows, by name: a name stays selected while it is on the page shown (R4.3, R4.4).
  const [selectedNames, setSelectedNames] = useState<readonly string[]>([]);
  if (functions !== undefined) {
    const kept = selectedNames.filter((name) => functions.some((fn) => fn.name === name));
    if (kept.length !== selectedNames.length) {
      setSelectedNames(kept);
    }
  }
  const selected = (functions ?? []).filter((fn) => selectedNames.includes(fn.name));

  const [deleting, setDeleting] = useState<{
    names: readonly string[];
    revision: number;
    endpoint: string | undefined;
  }>();
  const connectionChanged = deleting !== undefined && deleting.revision !== network.revision;
  const confirmationExpired =
    deleting !== undefined &&
    (connectionChanged ||
      deleting.endpoint !== connection.engineOrigin ||
      !loaded ||
      listing.failure !== undefined ||
      !deleting.names.every((name) => selected.some((fn) => fn.name === name)));
  const canSubmitDeletion = useCallback(
    () => !confirmationExpired && deleting?.revision === connectionRevision.current,
    [confirmationExpired, deleting],
  );

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
      if (
        detail.id === 'delete' &&
        selected.length > 0 &&
        listing.failure === undefined &&
        network.revision === connectionRevision.current
      ) {
        setDeleting({
          names: selected.map((fn) => fn.name),
          revision: network.revision,
          endpoint: connection.engineOrigin,
        });
      }
    },
    [selected, listing.failure, network.revision, connection.engineOrigin, setDeleting],
  );

  const handleDialogClose = useCallback(
    (result?: DeleteResult) => {
      if (result?.interrupted) {
        setSelectedNames((names) => names.filter((name) => !result.deleted.includes(name)));
      }
      setDeleting(undefined);
      // Focus returns to what opened the dialog (R7).
      actionsRef.current?.focus();
    },
    [setDeleting],
  );
  const handleExpiredDraft = useCallback(() => {
    if (connectionChanged) {
      flash.show([{ type: 'info', content: EXPIRED_DRAFT }]);
    }
  }, [connectionChanged, flash]);

  const handleCreate = useCallback(() => {
    void navigate(CREATE_FUNCTION_PATH);
  }, [navigate]);

  // A long word of a name or a description (64 or 256 characters without a space) breaks inside its cell instead of
  // widening its column past the viewport (issue 84, R11); how each breaks is its kind's (issue 467, R6).
  const columns: TableProps.ColumnDefinition<FunctionSummary>[] = [
    {
      id: 'name',
      header: 'Function name',
      isRowHeader: true,
      minWidth: NAME_MIN_WIDTH,
      cell: (fn) => (
        <Link href={functionPath(fn.name)} onFollow={handleFollow}>
          <ValueText kind="name" value={fn.name} />
        </Link>
      ),
    },
    {
      id: 'description',
      header: 'Description',
      // The cell's width is the table's to give, never its longest word's: a word longer than the column breaks inside
      // it instead of widening it past the viewport (issue 84, R11).
      cell: (fn) => (
        <div className="aws-lambda-description-cell">
          <ValueText kind="text" value={fn.description} none={NONE} />
        </div>
      ),
    },
    {
      id: 'packageType',
      header: 'Package type',
      cell: (fn) => <ValueText kind="fixed" value={fn.packageType} none={NONE} />,
    },
    {
      id: 'runtime',
      header: 'Runtime',
      minWidth: RUNTIME_MIN_WIDTH,
      cell: (fn) => <ValueText kind="fixed" value={runtimeText(fn.runtime)} />,
    },
    { id: 'type', header: 'Type', cell: (fn) => <ValueText kind="fixed" value={typeText(fn.durable)} /> },
    {
      id: 'lastModified',
      header: 'Last modified',
      cell: (fn) => <ValueText kind="fixed" value={lastModifiedText(fn.lastModified)} />,
    },
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
            description={DESCRIPTION}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={handleRefresh} />
                <ButtonDropdown
                  ref={actionsRef}
                  items={[{ id: 'delete', text: 'Delete' }]}
                  disabled={selected.length === 0 || listing.failure !== undefined}
                  disabledReason={state.kind === 'loading' ? WAIT_FOR_LIST : SELECT_FIRST}
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
      <DeleteFunctionsDialog
        names={deleting?.names ?? NO_DELETE_TARGETS}
        connection={connection}
        online={network.online}
        confirmationExpired={confirmationExpired}
        onExpiredDraft={handleExpiredDraft}
        canSubmit={canSubmitDeletion}
        onClose={handleDialogClose}
        reportEmptyInterruption
      />
      {announcement}
    </>
  );
}
