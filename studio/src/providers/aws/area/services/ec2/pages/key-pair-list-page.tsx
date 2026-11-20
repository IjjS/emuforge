import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import TextFilter from '@cloudscape-design/components/text-filter';
import { useCallback, useState } from 'react';

import { actionFailureItem, readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import { creationDateText } from '../../../components/format-date';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { DeleteKeyPairDialog } from '../components/delete-key-pair-dialog';
import { CREATE_KEY_PAIR_PATH, KEY_PAIRS_TITLE, KEY_PAIRS_WORD, NONE } from '../format';
import { KEY_PAIR_OPERATIONS, type KeyPair } from '../key-pair-api';
import { useDeleteKeyPair, useKeyPairListing } from '../key-pair-queries';

// The key pairs, S8 (issue 553, design task 5): every key pair of one `DescribeKeyPairs`, which answers all of them
// at once (the operation has no pages), so the table filters by name and pages what that answer holds itself, 25 a
// page. For the one selected key pair, "Delete"; the emulator answers 200 also for a key pair already gone, so the
// result says "Deleted key pair {name}" either way.

/** The rows of one page of the table. */
const KEY_PAIRS_PAGE_SIZE = 25;

const SELECT_ONE = 'Select one key pair.';

/** A name keeps room for 24 characters (`aws-area.md`, entry 4). */
const NAME_MIN_WIDTH = '24ch';

/** The key pairs whose name holds `text`, in either case; all of them for no text. */
function matching(keyPairs: readonly KeyPair[], text: string): KeyPair[] {
  const wanted = text.trim().toLowerCase();
  return wanted === '' ? [...keyPairs] : keyPairs.filter((keyPair) => keyPair.name.toLowerCase().includes(wanted));
}

/**
 * `/aws/ec2/key-pairs`. A failed read, or a list shown while the connection was not connected, is read again by
 * itself once the connection is connected again, so after an emulator restart it shows the empty emulator.
 */
export function KeyPairListPage({ connection }: ScreenPageProps) {
  useShowsResources(KEY_PAIRS_WORD);
  const handleFollow = useFollow();
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
  const [announcement, announce] = useAnnouncer();
  const engineOrigin = connection.engineOrigin;
  const listing = useKeyPairListing(engineOrigin);
  const remove = useDeleteKeyPair(engineOrigin);
  const { items, refresh } = listing;

  const [filterText, setFilterText] = useState('');
  const [pageIndex, setPageIndex] = useState(1);
  const [selectedName, setSelectedName] = useState<string>();
  const [deleteFor, setDeleteFor] = useState<string>();
  const [deleting, setDeleting] = useState(false);

  const failure =
    listing.failure === undefined ? undefined : readFailureState(listing.failure, connection, 'key pair list');

  // Kept from the previous render, as React's own pattern for it, so each change is acted on once.
  const failureLine = failure?.firstText;
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

  const filtered = matching(items ?? [], filterText);
  const pagesCount = Math.max(1, Math.ceil(filtered.length / KEY_PAIRS_PAGE_SIZE));
  const page = Math.min(pageIndex, pagesCount);
  const rows = filtered.slice((page - 1) * KEY_PAIRS_PAGE_SIZE, page * KEY_PAIRS_PAGE_SIZE);
  const selected = rows.find((row) => row.name === selectedName);

  const handleRetry = useCallback(() => {
    refresh();
  }, [refresh]);

  const handleClearFilter = () => {
    setFilterText('');
    setPageIndex(1);
    setSelectedName(undefined);
  };

  const handleDelete = () => {
    if (deleteFor === undefined || deleting) {
      return;
    }
    const name = deleteFor;
    const signal = pageSignal();
    setDeleting(true);
    remove(name, signal).then(
      () => {
        if (signal.aborted) {
          return;
        }
        setDeleting(false);
        setDeleteFor(undefined);
        setSelectedName(undefined);
        flash.show([{ type: 'success', content: `Deleted key pair ${name}` }]);
      },
      (error: unknown) => {
        if (signal.aborted) {
          return;
        }
        setDeleting(false);
        setDeleteFor(undefined);
        flash.show([
          actionFailureItem(
            failureOf(error, KEY_PAIR_OPERATIONS.deleteKeyPair),
            `Deleting key pair ${name}`,
            engineOrigin,
          ),
        ]);
      },
    );
  };

  const columns: TableProps.ColumnDefinition<KeyPair>[] = [
    {
      id: 'name',
      header: 'Name',
      isRowHeader: true,
      minWidth: NAME_MIN_WIDTH,
      cell: (row) => <ValueText kind="name" value={row.name} />,
    },
    { id: 'type', header: 'Type', cell: (row) => <ValueText kind="fixed" value={row.type} none={NONE} /> },
    {
      id: 'fingerprint',
      header: 'Fingerprint',
      cell: (row) => <ValueText kind="address" value={row.fingerprint} none={NONE} />,
    },
    { id: 'id', header: 'Key pair ID', cell: (row) => <ValueText kind="name" value={row.id} none={NONE} /> },
    {
      id: 'created',
      header: 'Created',
      cell: (row) => <ValueText kind="fixed" value={creationDateText(row.createdAt)} />,
    },
  ];

  let empty = null;
  if (failure !== undefined) {
    empty = <ReadFailure state={failure} onRetry={handleRetry} />;
  } else if (items !== undefined && items.length === 0) {
    empty = (
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            No key pairs
          </Box>
          <Box variant="p" color="inherit">
            The emulator holds no key pair yet.
          </Box>
        </SpaceBetween>
        <Box margin={{ top: 's' }}>
          <Button href={CREATE_KEY_PAIR_PATH} onFollow={handleFollow}>
            Create key pair
          </Button>
        </Box>
      </Box>
    );
  } else if (items !== undefined) {
    empty = (
      <Box textAlign="center" color="inherit">
        <Box variant="strong" color="inherit">
          No key pairs match
        </Box>
        <Box margin={{ top: 's' }}>
          <Button onClick={handleClearFilter}>Clear filter</Button>
        </Box>
      </Box>
    );
  }

  const shown = failure === undefined ? items : undefined;

  return (
    <>
      <Table<KeyPair>
        variant="full-page"
        items={failure === undefined ? rows : []}
        trackBy="name"
        selectionType="single"
        selectedItems={selected === undefined ? [] : [selected]}
        onSelectionChange={({ detail }) => {
          setSelectedName(detail.selectedItems[0]?.name);
        }}
        ariaLabels={{
          selectionGroupLabel: 'Key pair selection',
          itemSelectionLabel: (_, row) => row.name,
        }}
        columnDefinitions={columns}
        wrapLines
        loading={failure === undefined && items === undefined}
        loadingText="Loading key pairs"
        empty={empty}
        filter={
          <TextFilter
            filteringText={filterText}
            filteringPlaceholder="Find by name"
            filteringAriaLabel="Name"
            filteringClearAriaLabel="Clear the name filter"
            {...(shown !== undefined &&
              filterText !== '' && {
                countText: `${String(filtered.length)} ${filtered.length === 1 ? 'match' : 'matches'}`,
              })}
            onChange={({ detail }) => {
              setFilterText(detail.filteringText);
              setPageIndex(1);
              setSelectedName(undefined);
            }}
          />
        }
        header={
          <Header
            variant="awsui-h1-sticky"
            counter={shown === undefined ? undefined : `(${String(shown.length)})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" loading={listing.loading} onClick={refresh} />
                <Button
                  disabled={selected === undefined || deleting}
                  disabledReason={selected === undefined ? SELECT_ONE : undefined}
                  onClick={() => {
                    if (selected !== undefined) {
                      setDeleteFor(selected.name);
                    }
                  }}
                >
                  Delete
                </Button>
                <Button variant="primary" href={CREATE_KEY_PAIR_PATH} onFollow={handleFollow}>
                  Create key pair
                </Button>
              </SpaceBetween>
            }
          >
            {KEY_PAIRS_TITLE}
          </Header>
        }
        pagination={
          <Pagination
            currentPageIndex={page}
            pagesCount={pagesCount}
            disabled={shown === undefined}
            ariaLabels={{
              nextPageLabel: 'Next page',
              previousPageLabel: 'Previous page',
              pageLabel: (number) => `Page ${String(number)}`,
            }}
            onChange={({ detail }) => {
              setSelectedName(undefined);
              setPageIndex(detail.currentPageIndex);
            }}
          />
        }
      />
      <DeleteKeyPairDialog
        visible={deleteFor !== undefined}
        name={deleteFor ?? ''}
        pending={deleting}
        onConfirm={handleDelete}
        onDismiss={() => {
          setDeleteFor(undefined);
        }}
      />
      {announcement}
    </>
  );
}
