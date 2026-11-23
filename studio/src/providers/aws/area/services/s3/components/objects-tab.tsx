import Button from '@cloudscape-design/components/button';
import CollectionPreferences, {
  type CollectionPreferencesProps,
} from '@cloudscape-design/components/collection-preferences';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import TextFilter, { type TextFilterProps } from '@cloudscape-design/components/text-filter';
import Toggle from '@cloudscape-design/components/toggle';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAreaModalRoot } from '../../../components/area-modal';
import type { AreaConnection } from '../../../components/emulator-line';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import { NO_SUCH_BUCKET } from '../api';
import { NO_VALUE, objectPath, objectsPath, s3Uri, uploadPath } from '../format';
import { useObjectListing, type BucketCount } from '../queries';
import { lineText } from './bucket-read';
import { CreateFolderDialog } from './create-folder-dialog';
import { DeleteObjectsDialog } from './delete-objects-dialog';
import { NAME_COLUMN_MIN_WIDTH } from './name-column';
import { ObjectVersions } from './object-versions';
import { listingFailure, objectRows, rowType, type Row } from './objects-rows';
import { ObjectsBucketGone, ObjectsTableBody, type ObjectsBody } from './objects-states';

// A bucket's tab "Objects" (issue 480, task 1): the folders, then the objects, of the folder the address names, one
// page of `ListObjectsV2` at a time, following its tokens; "Find objects by prefix" sends the folder plus the text as
// `Prefix`; "Refresh" asks page 1 again; "Copy S3 URI" copies one selected row's URI. Every value from the emulator is
// text, each as the kind of value it is. The page mounts the tab anew for each folder, so its filter, pages and
// selection start afresh there.

const TABLE_TITLE = 'Objects';
const REFRESHED = 'Objects refreshed';
const URI_COPIED = 'S3 URI copied';
const URI_NOT_COPIED = "Couldn't copy the S3 URI";
const SELECT_ONE = 'Select one object or folder first';
const SELECT_ONLY_ONE = 'Select only one object or folder';
const SELECT_TO_DELETE = 'Select the objects or folders to delete first';

/** How long the result of "Copy S3 URI" stays beside the button. */
const COPY_RESULT_MS = 3_000;

/** The page size and "Wrap lines" at the start of every visit; stored nowhere. */
const START_PREFERENCES = { pageSize: 100, wrapLines: true };

const PAGE_SIZES = [50, 100, 300, 1000] as const;

function counterText(count: BucketCount): string {
  return `(${String(count.total)}${count.more ? '+' : ''})`;
}

/** "1 match", "2 matches", "100+ matches". */
function matchesText(count: BucketCount): string {
  const total = `${String(count.total)}${count.more ? '+' : ''}`;
  return count.total === 1 && !count.more ? '1 match' : `${total} matches`;
}

/** The control whose use started the listing being read: it stays enabled, so it keeps focus. */
type Starter = 'filter' | 'pagination' | 'preferences' | 'refresh' | null;

interface ObjectsTabProps {
  name: string;
  /** The folder shown, the address's `?prefix=`; `''` at the root. */
  prefix: string;
  connection: AreaConnection;
  /** Says a text in the page's polite live region. */
  announce: (text: string) => void;
}

/** The tab "Objects" of bucket `name` at `prefix`. */
export function ObjectsTab(props: ObjectsTabProps) {
  const [showVersions, setShowVersions] = useState(false);
  const [objectsRevision, setObjectsRevision] = useState(0);

  return (
    <SpaceBetween size="s">
      <Toggle checked={showVersions} onChange={({ detail }) => setShowVersions(detail.checked)}>
        Show versions
      </Toggle>
      <CurrentObjects {...props} visible={!showVersions} revision={objectsRevision} />
      {showVersions && (
        <ObjectVersions
          name={props.name}
          prefix={props.prefix}
          endpoint={props.connection.engineOrigin}
          onChanged={() => setObjectsRevision((current) => current + 1)}
        />
      )}
    </SpaceBetween>
  );
}

/** The ordinary listing stays ready at this prefix while version history is open. */
function CurrentObjects({
  name,
  prefix,
  connection,
  announce,
  visible,
  revision,
}: ObjectsTabProps & { visible: boolean; revision: number }) {
  const handleFollow = useFollow();
  const modalRoot = useAreaModalRoot();
  const filterRef = useRef<TextFilterProps.Ref>(null);

  const [filter, setFilter] = useState('');
  const [preferences, setPreferences] = useState(START_PREFERENCES);
  const [starter, setStarter] = useState<Starter>(null);
  const listing = useObjectListing({
    endpoint: connection.engineOrigin,
    bucket: name,
    prefix,
    filter,
    pageSize: preferences.pageSize,
    revision,
  });
  const { page, refresh } = listing;
  const rows = page === undefined || page === NO_SUCH_BUCKET ? undefined : objectRows(page, prefix);
  const loaded = rows !== undefined;
  const count: BucketCount | undefined =
    page === undefined || page === NO_SUCH_BUCKET || rows === undefined
      ? undefined
      : { total: rows.length, more: page.nextToken !== undefined };

  let state: ObjectsBody;
  if (listing.failure !== undefined) {
    state = { kind: 'failure', view: listingFailure(listing.failure, connection) };
  } else if (rows === undefined) {
    state = { kind: 'loading' };
  } else if (rows.length > 0) {
    state = { kind: 'rows' };
  } else {
    state = listing.text === '' ? { kind: 'empty', prefix } : { kind: 'no-match', prefix, text: listing.text };
  }

  // The selection, kept for the page of the listing it was made on: a page change, a filter, "Refresh" or a new
  // folder clears it, so an action counts only rows in view.
  const [selection, setSelection] = useState<{ view: string; ids: readonly string[] }>({ view: '', ids: [] });
  const selected =
    rows === undefined || selection.view !== listing.view ? [] : rows.filter((row) => selection.ids.includes(row.id));

  // Kept from the previous render, as React's own pattern for it: each change is acted on once, in the render that
  // first shows it.
  const [refreshing, setRefreshing] = useState(false);
  if (refreshing && rows !== undefined) {
    setRefreshing(false);
    announce(REFRESHED);
  } else if (refreshing && (listing.failure !== undefined || page === NO_SUCH_BUCKET)) {
    setRefreshing(false);
  }
  const failureLine = state.kind === 'failure' ? lineText(state.view.first) : undefined;
  const [seenFailureLine, setSeenFailureLine] = useState<string>();
  if (failureLine !== seenFailureLine) {
    setSeenFailureLine(failureLine);
    if (failureLine !== undefined) {
      announce(failureLine);
    }
  }

  // "Copy S3 URI": `s3://{name}/{key}` of the one selected row; calls nothing.
  const [copyResult, setCopyResult] = useState<{ ok: boolean; id: number }>();
  useEffect(() => {
    if (copyResult === undefined) {
      return;
    }
    const timer = setTimeout(() => {
      setCopyResult(undefined);
    }, COPY_RESULT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [copyResult]);
  const onlyId = selected.length === 1 ? selected[0]?.id : undefined;
  const handleCopyUri = () => {
    if (onlyId === undefined) {
      return;
    }
    const report = (ok: boolean) => {
      setCopyResult((current) => ({ ok, id: (current?.id ?? 0) + 1 }));
      announce(ok ? URI_COPIED : URI_NOT_COPIED);
    };
    // The clipboard is missing outside a secure context.
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (clipboard === undefined) {
      report(false);
      return;
    }
    clipboard.writeText(s3Uri(name, onlyId)).then(
      () => {
        report(true);
      },
      () => {
        report(false);
      },
    );
  };
  const copyDisabledReason = selected.length === 0 ? SELECT_ONE : selected.length > 1 ? SELECT_ONLY_ONE : undefined;

  // "Delete": the dialog for the rows selected (task 4); once a deletion ran, the listing is asked again.
  const [deleting, setDeleting] = useState<{ keys: string[]; folders: string[] }>();
  const handleDelete = () => {
    setDeleting({
      keys: selected.flatMap((row) => (row.kind === 'object' ? [row.id] : [])),
      folders: selected.flatMap((row) => (row.kind === 'folder' ? [row.id] : [])),
    });
  };
  const handleDeleteClose = useCallback(
    (changed: boolean) => {
      setDeleting(undefined);
      if (changed) {
        setStarter(null);
        refresh();
      }
    },
    [refresh],
  );

  // "Create folder" (task 3): the dialog; once a folder was put, the listing is asked again.
  const [creatingFolder, setCreatingFolder] = useState(false);
  const handleCreateFolderClose = useCallback(
    (created: boolean) => {
      setCreatingFolder(false);
      if (created) {
        setStarter(null);
        refresh();
      }
    },
    [refresh],
  );

  const handleRefresh = useCallback(() => {
    setStarter('refresh');
    setRefreshing(true);
    refresh();
  }, [refresh]);

  const handleRetry = useCallback(() => {
    setStarter(null);
    refresh();
  }, [refresh]);

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

  const view = listing.view;
  const handleSelection = useCallback(
    ({ detail }: { detail: TableProps.SelectionChangeDetail<Row> }) => {
      setSelection({ view, ids: detail.selectedItems.map((row) => row.id) });
    },
    [view],
  );

  if (!visible) return null;
  if (page === NO_SUCH_BUCKET) {
    return <ObjectsBucketGone name={name} />;
  }

  // A key of up to 24 characters is on one line; a longer one breaks inside its cell rather than widening its column.
  const columns: TableProps.ColumnDefinition<Row>[] = [
    {
      id: 'key',
      header: 'Key',
      isRowHeader: true,
      minWidth: NAME_COLUMN_MIN_WIDTH,
      cell: (row) => (
        <Link
          href={row.kind === 'folder' ? objectsPath(name, row.id) : objectPath(name, row.id)}
          onFollow={handleFollow}
        >
          <ValueText kind="name" value={row.name} />
        </Link>
      ),
    },
    { id: 'type', header: 'Type', cell: (row) => <ValueText kind="fixed" value={rowType(row)} /> },
    {
      id: 'lastModified',
      header: 'Last modified',
      cell: (row) => <ValueText kind="fixed" value={row.kind === 'folder' ? NO_VALUE : row.lastModified} />,
    },
    {
      id: 'size',
      header: 'Size',
      cell: (row) => <ValueText kind="fixed" value={row.kind === 'folder' ? NO_VALUE : row.size} />,
    },
    {
      id: 'storageClass',
      header: 'Storage class',
      cell: (row) => <ValueText kind="fixed" value={row.kind === 'folder' ? NO_VALUE : row.storageClass} />,
    },
  ];

  return (
    <>
      <DeleteObjectsDialog
        visible={deleting !== undefined}
        endpoint={connection.engineOrigin}
        bucket={name}
        selection={deleting ?? { keys: [], folders: [] }}
        onClose={handleDeleteClose}
      />
      <CreateFolderDialog
        visible={creatingFolder}
        endpoint={connection.engineOrigin}
        bucket={name}
        prefix={prefix}
        onClose={handleCreateFolderClose}
      />
      <Table<Row>
        items={rows ?? []}
        trackBy="id"
        columnDefinitions={columns}
        selectionType="multi"
        selectedItems={selected}
        onSelectionChange={handleSelection}
        ariaLabels={{
          selectionGroupLabel: 'Object selection',
          allItemsSelectionLabel: () => 'Select every object and folder on this page',
          itemSelectionLabel: (_, row) => `Select ${row.name}`,
        }}
        wrapLines={preferences.wrapLines}
        loading={state.kind === 'loading'}
        loadingText="Loading objects"
        empty={<ObjectsTableBody state={state} onClearFilter={handleClearFilter} onRetry={handleRetry} />}
        header={
          <Header
            variant="h2"
            counter={count === undefined ? undefined : counterText(count)}
            actions={
              <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                <Button iconName="refresh" disabled={!loaded && starter !== 'refresh'} onClick={handleRefresh}>
                  Refresh
                </Button>
                {copyResult !== undefined && (
                  <StatusIndicator type={copyResult.ok ? 'success' : 'error'}>
                    {copyResult.ok ? URI_COPIED : URI_NOT_COPIED}
                  </StatusIndicator>
                )}
                <Button
                  iconName="copy"
                  disabled={copyDisabledReason !== undefined}
                  {...(copyDisabledReason === undefined ? {} : { disabledReason: copyDisabledReason })}
                  onClick={handleCopyUri}
                >
                  Copy S3 URI
                </Button>
                <Button
                  disabled={selected.length === 0}
                  {...(selected.length === 0 && { disabledReason: SELECT_TO_DELETE })}
                  onClick={handleDelete}
                >
                  Delete
                </Button>
                <Button
                  onClick={() => {
                    setCreatingFolder(true);
                  }}
                >
                  Create folder
                </Button>
                <Button variant="primary" iconName="upload" href={uploadPath(name, prefix)} onFollow={handleFollow}>
                  Upload
                </Button>
              </SpaceBetween>
            }
          >
            {TABLE_TITLE}
          </Header>
        }
        filter={
          <TextFilter
            ref={filterRef}
            filteringText={filter}
            filteringPlaceholder="Find objects by prefix"
            filteringAriaLabel="Find objects by prefix"
            disabled={!loaded && state.kind !== 'failure' && starter !== 'filter'}
            {...(listing.text !== '' && count !== undefined && { countText: matchesText(count) })}
            onChange={handleFilterChange}
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
              pageLabel: (number) => `Page ${String(number)}`,
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
              options: PAGE_SIZES.map((size) => ({ value: size, label: `${String(size)} objects` })),
            }}
            wrapLinesPreference={{ label: 'Wrap lines', description: 'Show all of a long key or date' }}
            onConfirm={handlePreferences}
          />
        }
      />
    </>
  );
}
