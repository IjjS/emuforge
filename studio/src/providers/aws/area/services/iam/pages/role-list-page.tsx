import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import CollectionPreferences, {
  type CollectionPreferencesProps,
} from '@cloudscape-design/components/collection-preferences';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import TextFilter, { type TextFilterProps } from '@cloudscape-design/components/text-filter';
import { useCallback, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';

import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import type { Role } from '../api';
import { CREATE_ROLE_PATH, lastActivityText, rolePath, trustedEntitiesText } from '../format';
import { useRoleListing, type Listing, type ListingCount } from '../queries';
import { DeleteRolesDialog } from '../components/delete-roles-dialog';
import { NAME_COLUMN_MIN_WIDTH, useAnnouncer, useAreaModalRoot } from '../components/page-parts';
import { readFailureState, type ReadFailureState } from '../components/failures';
import { ReadFailure } from '../components/states';

// IAM's role list (issue 82, requirement R3, R4, R7 to R10): the console's "Roles" page in the console's words; its
// description and states in EmuForge's own. Every value from the engine or the emulator is rendered as text, each cell
// as the kind of value it is (issue 467, requirement R6).

/** The page's title, its `h1` without the counter. */
export const ROLES_TITLE = 'Roles';

/** The `h1`'s description in every state of the connection: what a column reports (issue 467, R3). */
const DESCRIPTION = 'Last activity is what the emulator reports for a role.';

const SELECT_FIRST = 'Select a role first';
const REFRESHED = 'Role list refreshed';
/** What a failed read names (R10.1). */
const THING = 'role list';

/** The page size and "Wrap lines" at the start of every visit (R4.8); stored nowhere. */
const START_PREFERENCES = { pageSize: 20, wrapLines: true };

const PAGE_SIZES = [10, 20, 50] as const;

/** What the table's body shows (R10), the rows aside. */
type BodyState =
  | { kind: 'loading' }
  | { kind: 'rows' }
  | { kind: 'empty' }
  | { kind: 'no-match'; text: string }
  | ({ kind: 'failure' } & ReadFailureState);

function bodyState(listing: Listing<Role>, connection: ScreenPageProps['connection']): BodyState {
  if (listing.failure !== undefined) {
    return { kind: 'failure', ...readFailureState(listing.failure, connection, THING) };
  }
  if (listing.items === undefined) {
    return { kind: 'loading' };
  }
  if (listing.items.length > 0) {
    return { kind: 'rows' };
  }
  return listing.filter === '' ? { kind: 'empty' } : { kind: 'no-match', text: listing.filter };
}

function countText(count: ListingCount): string {
  return `${String(count.total)}${count.more ? '+' : ''}`;
}

/** "1 match", "2 matches", "20+ matches" (R4.7). */
function matchesText(count: ListingCount): string {
  return count.total === 1 && !count.more ? '1 match' : `${countText(count)} matches`;
}

/** The control whose use started the listing being read: it stays enabled, so it keeps focus (R10.1). */
type Starter = 'filter' | 'pagination' | 'preferences' | null;

interface TableBodyProps {
  state: BodyState;
  onCreate: () => void;
  onClearFilter: () => void;
  onRetry: () => void;
}

/** The table's empty slot: the empty, no-match and failure states (R10), with Cloudscape's empty-table pattern. */
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
              No roles
            </Box>
            <Box variant="p" color="inherit">
              This emulator holds no roles. It starts empty each time it restarts. Create one here, or with any tool
              pointed at the emulator.
            </Box>
          </SpaceBetween>
          <Box margin={{ top: 's' }}>
            <Button onClick={onCreate}>Create role</Button>
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
              {`No role name contains “${state.text}”.`}
            </Box>
          </SpaceBetween>
          <Box margin={{ top: 's' }}>
            <Button onClick={onClearFilter}>Clear filter</Button>
          </Box>
        </Box>
      );
    case 'failure':
      return <ReadFailure state={state} onRetry={onRetry} />;
  }
}

/**
 * `/aws/iam` and `/aws/iam/roles`: the emulator's roles, read through the engine with `ListRoles` and a `GetRole`
 * per role on every opening and refresh, one page at a time (R4). The table keeps its heading, actions and columns in
 * every state and shows the state in its body (R10). A failed read while the connection is not connected repeats the
 * emulator line's status; once the connection is connected again the list is read again by itself.
 */
export function RoleListPage({ connection }: ScreenPageProps) {
  useShowsResources('roles');
  const handleFollow = useFollow();
  const navigate = useNavigate();
  const modalRoot = useAreaModalRoot();
  const [announcement, announce] = useAnnouncer();
  const filterRef = useRef<TextFilterProps.Ref>(null);
  const deleteRef = useRef<ButtonProps.Ref>(null);

  const [filter, setFilter] = useState('');
  const [preferences, setPreferences] = useState(START_PREFERENCES);
  const [starter, setStarter] = useState<Starter>(null);
  const listing = useRoleListing({ endpoint: connection.engineOrigin, pageSize: preferences.pageSize, filter });
  const { items: roles, refresh, applyFilter } = listing;
  const loaded = roles !== undefined;
  const state = bodyState(listing, connection);

  // Several rows, by name: a name stays selected while a role of that name is on the page shown (R4.3, R4.4).
  const [selectedNames, setSelectedNames] = useState<readonly string[]>([]);
  if (roles !== undefined) {
    const kept = selectedNames.filter((name) => roles.some((role) => role.name === name));
    if (kept.length !== selectedNames.length) {
      setSelectedNames(kept);
    }
  }
  const selected = (roles ?? []).filter((role) => selectedNames.includes(role.name));

  // The roles the delete dialog is open for, in the order of their rows; `undefined` while it is closed.
  const [deleting, setDeleting] = useState<readonly Role[]>();

  const startListing = useCallback(() => {
    setStarter(null);
    refresh();
  }, [refresh]);

  // Kept from the previous render, as React's own pattern for it: what was last seen of the listing and the
  // connection, so each change is acted on once, in the render that first shows it.
  const [refreshing, setRefreshing] = useState(false);
  const failureLine = state.kind === 'failure' ? state.firstText : undefined;
  const [seenFailureLine, setSeenFailureLine] = useState<string>();
  const connected = connection.result?.kind === 'connected';
  const [seenConnected, setSeenConnected] = useState(connected);
  // Whether the connection was not connected (a state other than "Checking") since the page last read: the emulator
  // may have restarted then, so what the page shows may be gone.
  const down = connection.result !== undefined && !connected;
  const [wasDown, setWasDown] = useState(down);
  if (down && !wasDown) {
    setWasDown(true);
  }
  // "Role list refreshed", once the refreshed listing's first page is shown (R8).
  if (refreshing && roles !== undefined) {
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
  // Once the connection becomes connected again, a failed read, or a list shown while the connection was not
  // connected, is read again by itself (R10.2).
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

  // Enter applies the text at once (R4.7).
  const handleFilterKey = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
        setStarter('filter');
        applyFilter();
      }
    },
    [applyFilter],
  );

  const handleClearFilter = useCallback(() => {
    setStarter('filter');
    setFilter('');
    filterRef.current?.focus();
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

  const handleSelection = useCallback(({ detail }: { detail: TableProps.SelectionChangeDetail<Role> }) => {
    setSelectedNames(detail.selectedItems.map((role) => role.name));
  }, []);

  const handleCloseDialog = useCallback(() => {
    // A finished delete lists again, and no control of the list started that listing.
    setStarter(null);
    setDeleting(undefined);
    deleteRef.current?.focus();
  }, []);

  const columns: TableProps.ColumnDefinition<Role>[] = [
    {
      id: 'name',
      header: 'Role name',
      isRowHeader: true,
      minWidth: NAME_COLUMN_MIN_WIDTH,
      cell: (role) => (
        <Link href={rolePath(role.name)} onFollow={handleFollow}>
          <ValueText kind="name" value={role.name} />
        </Link>
      ),
    },
    {
      id: 'trusted',
      header: 'Trusted entities',
      cell: (role) => <ValueText kind="text" value={trustedEntitiesText(role.trustPolicy, role.path)} />,
    },
    {
      id: 'lastActivity',
      header: 'Last activity',
      cell: (role) => <ValueText kind="fixed" value={lastActivityText(role.lastUsed)} />,
    },
  ];

  const count = loaded ? listing.count : undefined;
  const createRole = () => void navigate(CREATE_ROLE_PATH);

  return (
    <>
      <Table<Role>
        variant="full-page"
        items={roles ?? []}
        trackBy="name"
        columnDefinitions={columns}
        selectionType="multi"
        selectedItems={selected}
        onSelectionChange={handleSelection}
        ariaLabels={{
          tableLabel: ROLES_TITLE,
          selectionGroupLabel: 'Role selection',
          allItemsSelectionLabel: () => 'All items',
          itemSelectionLabel: (_, role) => role.name,
        }}
        wrapLines={preferences.wrapLines}
        loading={state.kind === 'loading'}
        loadingText="Loading roles"
        empty={
          <TableBody state={state} onCreate={createRole} onClearFilter={handleClearFilter} onRetry={startListing} />
        }
        header={
          <Header
            variant="awsui-h1-sticky"
            counter={count === undefined ? undefined : `(${countText(count)})`}
            description={DESCRIPTION}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh roles" onClick={handleRefresh} />
                <Button
                  ref={deleteRef}
                  disabled={selected.length === 0}
                  disabledReason={SELECT_FIRST}
                  onClick={() => {
                    if (selected.length > 0) {
                      setDeleting(selected);
                    }
                  }}
                >
                  Delete
                </Button>
                <Button variant="primary" onClick={createRole}>
                  Create role
                </Button>
              </SpaceBetween>
            }
          >
            {ROLES_TITLE}
          </Header>
        }
        filter={
          <div onKeyDown={handleFilterKey}>
            <TextFilter
              ref={filterRef}
              filteringText={filter}
              filteringPlaceholder="Search"
              filteringAriaLabel="Search items"
              disabled={!loaded && starter !== 'filter'}
              {...(listing.filter !== '' && count !== undefined && { countText: matchesText(count) })}
              onChange={handleFilterChange}
            />
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
              options: PAGE_SIZES.map((size) => ({ value: size, label: `${String(size)} roles` })),
            }}
            wrapLinesPreference={{ label: 'Wrap lines', description: 'Show all of a long name' }}
            onConfirm={handlePreferences}
          />
        }
      />
      {announcement}
      {deleting !== undefined && (
        <DeleteRolesDialog roles={deleting} connection={connection} onClose={handleCloseDialog} />
      )}
    </>
  );
}
