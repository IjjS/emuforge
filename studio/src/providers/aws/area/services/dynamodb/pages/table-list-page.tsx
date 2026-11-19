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
import { useCallback, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';

import { useAreaModalRoot } from '../../../components/area-modal';
import type { AreaConnection } from '../../../components/emulator-line';
import { readFailureState, ReadFailure, useAnnouncer, type ReadFailureState } from '../../../components/failure-states';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import type { Table as TableDescription } from '../api';
import { DeleteTableDialog, type TableToDelete } from '../components/delete-table-dialog';
import { capacityText, CREATE_TABLE_PATH, indexesText, keyText, NO_VALUE, statusText, tablePath } from '../format';
import { useTableListing, type TableListing } from '../queries';

// DynamoDB's table list, S1 (issue 496, design.md task 1 and task 5): the emulator's tables a page at a time on
// `ListTables`' own start names, each described with the page; a search by the start of a name; one table deleted at
// a time. Every value from the emulator is rendered as text, each as the kind of value it is (`aws-area.md`, entry 4).

/** The page's title, its `h1` and its crumb. */
export const TABLES_TITLE = 'Tables';

/** The `h1`'s description (requirement, "EmuForge's own text"). */
const DESCRIPTION = 'The search matches the start of a table name and is case-sensitive.';

const SEARCH_LABEL = 'Search tables';
const SEARCH_HINT = 'Press Enter to search.';
const REFRESHED = 'Tables refreshed';
const READING = 'Reading the tables';
const SELECT_FIRST = 'Select a table first';

/** A table's name keeps room for 24 characters (`aws-area.md`, entry 4). */
const NAME_MIN_WIDTH = '28ch';

/** The page size at the start of every visit; stored nowhere. */
const START_PREFERENCES = { pageSize: 25, wrapLines: true };

const PAGE_SIZES = [10, 25, 50] as const;

/** What the table's body shows, the rows aside. */
type BodyState =
  | { kind: 'loading' }
  | { kind: 'rows' }
  | { kind: 'empty' }
  | { kind: 'no-match'; search: string }
  | { kind: 'failure'; failure: ReadFailureState };

function bodyState(listing: TableListing, search: string, connection: AreaConnection): BodyState {
  if (listing.failure !== undefined) {
    return { kind: 'failure', failure: readFailureState(listing.failure, connection, 'table list') };
  }
  if (listing.tables === undefined) {
    return { kind: 'loading' };
  }
  if (listing.tables.length > 0) {
    return { kind: 'rows' };
  }
  return search === '' ? { kind: 'empty' } : { kind: 'no-match', search };
}

/** The control whose use started the listing being read: it stays enabled, so it keeps focus. */
type Starter = 'search' | 'pagination' | 'preferences' | null;

interface TableBodyProps {
  state: BodyState;
  onCreate: () => void;
  onClearSearch: () => void;
  onRetry: () => void;
}

/** The table's empty slot: the empty, no-match and failure states, with Cloudscape's empty-table pattern. */
function TableBody({ state, onCreate, onClearSearch, onRetry }: TableBodyProps) {
  switch (state.kind) {
    case 'loading':
    case 'rows':
      return null;
    case 'empty':
      return (
        <Box textAlign="center" color="inherit">
          <SpaceBetween size="xxs">
            <Box variant="strong" color="inherit">
              No tables
            </Box>
            <Box variant="p" color="inherit">
              This emulator holds no tables. Create one here, or with any tool pointed at the emulator. It starts empty
              each time it restarts.
            </Box>
          </SpaceBetween>
          <Box margin={{ top: 's' }}>
            <Button onClick={onCreate}>Create table</Button>
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
              <ValueText kind="text" value="No table name starts with “" />
              <ValueText kind="name" value={state.search} />
              <ValueText kind="text" value="”." />
            </Box>
          </SpaceBetween>
          <Box margin={{ top: 's' }}>
            <Button onClick={onClearSearch}>Clear search</Button>
          </Box>
        </Box>
      );
    case 'failure':
      return <ReadFailure state={state.failure} onRetry={onRetry} />;
  }
}

/** The header's counter: the tables of the pages read, with a plus while a next page follows ("(25+)"). */
function counterText(listing: TableListing): string | undefined {
  const { count } = listing;
  return count === undefined ? undefined : `(${String(count.total)}${count.more ? '+' : ''})`;
}

/**
 * `/aws/dynamodb` and `/aws/dynamodb/tables`: the emulator's tables, read through the engine on every opening,
 * refresh, search and page. The table keeps its heading, controls and columns in every state and shows the state in
 * its body. A failed read, or a list shown while the connection was not connected, is read again by itself once the
 * connection is connected again (requirement, "States": after an emulator restart the list shows the empty emulator).
 */
export function TableListPage({ connection }: ScreenPageProps) {
  useShowsResources('tables');
  const handleFollow = useFollow();
  const navigate = useNavigate();
  const flash = usePageFlash();
  const modalRoot = useAreaModalRoot();
  const [announcement, announce] = useAnnouncer();
  const searchRef = useRef<TextFilterProps.Ref>(null);

  // The text in the field, and the text the listing was last asked with (on Enter, or at once when cleared).
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [preferences, setPreferences] = useState(START_PREFERENCES);
  const [starter, setStarter] = useState<Starter>(null);
  const connected = connection.result?.kind === 'connected';
  const listing = useTableListing({
    endpoint: connection.engineOrigin,
    pageSize: preferences.pageSize,
    search,
    connected,
  });
  const { tables, refresh, currentPage, goToPage } = listing;
  const loaded = tables !== undefined && !listing.loading;
  const state = bodyState(listing, search, connection);

  // The selected table by name: a new listing that no longer holds it leaves nothing selected.
  const [selectedName, setSelectedName] = useState<string>();
  const selected = tables?.find((table) => table.name === selectedName);
  const [deleting, setDeleting] = useState<TableToDelete>();

  const startListing = useCallback(() => {
    setStarter(null);
    refresh();
  }, [refresh]);

  // "Retry" reads the page that failed again, with the start name it was asked with.
  const handleRetry = useCallback(() => {
    setStarter(null);
    goToPage(currentPage);
  }, [goToPage, currentPage]);

  // Kept from the previous render, as React's own pattern for it: each change is acted on once, in the render that
  // first shows it.
  if (loaded && starter !== null) {
    setStarter(null);
  }
  const [refreshing, setRefreshing] = useState(false);
  if (refreshing && loaded) {
    setRefreshing(false);
    announce(REFRESHED);
  } else if (refreshing && listing.failure !== undefined) {
    setRefreshing(false);
  }
  const failureLine = state.kind === 'failure' ? state.failure.firstText : undefined;
  const [seenFailureLine, setSeenFailureLine] = useState<string>();
  if (failureLine !== seenFailureLine) {
    setSeenFailureLine(failureLine);
    if (failureLine !== undefined) {
      announce(failureLine);
    }
  }

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    startListing();
  }, [startListing]);

  const applySearch = useCallback((text: string) => {
    setStarter('search');
    setSearch(text);
  }, []);

  const handleSearchChange = useCallback(
    ({ detail }: { detail: TextFilterProps.ChangeDetail }) => {
      setTyped(detail.filteringText);
      // Clearing the field shows every table at once; any other text waits for Enter.
      if (detail.filteringText === '') {
        applySearch('');
      }
    },
    [applySearch],
  );

  const handleSearchKey = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applySearch(typed);
    }
  };

  const handleClearSearch = useCallback(() => {
    setTyped('');
    applySearch('');
    searchRef.current?.focus();
  }, [applySearch]);

  const handleCreate = useCallback(() => {
    void navigate(CREATE_TABLE_PATH);
  }, [navigate]);

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

  const handleDeleted = useCallback(
    (result: Parameters<typeof flash.show>[0]) => {
      setSelectedName(undefined);
      flash.show(result);
    },
    [flash],
  );

  const columns: TableProps.ColumnDefinition<TableDescription>[] = [
    {
      id: 'name',
      header: 'Name',
      isRowHeader: true,
      minWidth: NAME_MIN_WIDTH,
      cell: (table) => (
        <Link href={tablePath(table.name)} onFollow={handleFollow}>
          <ValueText kind="name" value={table.name} />
        </Link>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (table) => {
        const status = statusText(table.status);
        return (
          <StatusIndicator type={status.type}>
            <ValueText kind="fixed" value={status.text} />
          </StatusIndicator>
        );
      },
    },
    {
      id: 'partitionKey',
      header: 'Partition key',
      cell: (table) => <ValueText kind="name" value={keyText(table.partitionKey)} none={NO_VALUE} />,
    },
    {
      id: 'sortKey',
      header: 'Sort key',
      cell: (table) => <ValueText kind="name" value={keyText(table.sortKey)} none={NO_VALUE} />,
    },
    {
      id: 'indexes',
      header: 'Indexes',
      cell: (table) => <ValueText kind="fixed" value={indexesText(table)} />,
    },
    {
      id: 'capacity',
      header: 'Capacity mode',
      cell: (table) => <ValueText kind="text" value={capacityText(table.capacity)} />,
    },
  ];

  return (
    <>
      <Table<TableDescription>
        variant="full-page"
        items={tables ?? []}
        trackBy="name"
        selectionType="single"
        selectedItems={selected === undefined ? [] : [selected]}
        onSelectionChange={({ detail }) => {
          setSelectedName(detail.selectedItems[0]?.name);
        }}
        ariaLabels={{
          selectionGroupLabel: 'Tables',
          itemSelectionLabel: (_, table) => `Select ${table.name}`,
          allItemsSelectionLabel: () => 'All tables',
        }}
        stickyColumns={{ first: 1 }}
        columnDefinitions={columns}
        wrapLines={preferences.wrapLines}
        loading={state.kind === 'loading'}
        loadingText="Loading tables"
        empty={
          <TableBody state={state} onCreate={handleCreate} onClearSearch={handleClearSearch} onRetry={handleRetry} />
        }
        header={
          <Header
            variant="awsui-h1-sticky"
            counter={counterText(listing)}
            description={DESCRIPTION}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button
                  iconName="refresh"
                  ariaLabel="Refresh"
                  disabled={listing.loading}
                  disabledReason={READING}
                  onClick={handleRefresh}
                />
                <Button
                  disabled={selected === undefined}
                  disabledReason={SELECT_FIRST}
                  onClick={() => {
                    if (selected !== undefined) {
                      setDeleting({
                        name: selected.name,
                        ...(selected.deletionProtection === undefined
                          ? {}
                          : { deletionProtection: selected.deletionProtection }),
                      });
                    }
                  }}
                >
                  Delete
                </Button>
                <Button variant="primary" href={CREATE_TABLE_PATH} onFollow={handleFollow}>
                  Create table
                </Button>
              </SpaceBetween>
            }
          >
            {TABLES_TITLE}
          </Header>
        }
        filter={
          <div onKeyDown={handleSearchKey}>
            <FormField constraintText={SEARCH_HINT} stretch>
              <TextFilter
                ref={searchRef}
                filteringText={typed}
                filteringPlaceholder={SEARCH_LABEL}
                filteringAriaLabel={SEARCH_LABEL}
                filteringClearAriaLabel="Clear search"
                disabled={!loaded && starter !== 'search' && state.kind !== 'failure'}
                onChange={handleSearchChange}
              />
            </FormField>
          </div>
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
              options: PAGE_SIZES.map((size) => ({ value: size, label: `${String(size)} tables` })),
            }}
            wrapLinesPreference={{ label: 'Wrap lines', description: 'Show all of a long table name' }}
            onConfirm={handlePreferences}
          />
        }
      />
      <DeleteTableDialog
        table={deleting}
        engineOrigin={connection.engineOrigin}
        onDeleted={handleDeleted}
        onClose={() => {
          setDeleting(undefined);
        }}
      />
      {announcement}
    </>
  );
}
