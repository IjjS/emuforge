import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import {
  actionFailureItem,
  readFailureState,
  ReadFailure,
  useAnnouncer,
  type ReadFailureState,
} from '../../../components/failure-states';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import { OPERATIONS } from '../api';
import { DeleteTopicDialog } from '../components/delete-topic-dialog';
import { CREATE_TOPIC_PATH, topicHref, topicName, topicType } from '../format';
import { failureOf, useDeleteTopic, usePageSignal, useTopicListing, type Listing } from '../queries';

// SNS's topics, S1 (issue 536, design task 1 step 1 and task 5 step 2): every topic of the emulator, a page of
// `ListTopics` at a time on its own tokens, in the API's order. `ListTopics` gives each topic's ARN alone, and the
// page calls nothing per topic: the name and the type come from the ARN. No search: the API has no filter.

/** The page's title, its `h1` and its crumb. */
export const TOPICS_TITLE = 'Topics';

const DESCRIPTION = "A topic's page shows who is subscribed and whether a notification can reach them.";
const SELECT_FIRST = 'Select a topic';
const READING = 'Reading the topics';
const REFRESHED = 'Topic list refreshed';
const ARN_COPIED = 'ARN copied';
const ARN_NOT_COPIED = 'The ARN could not be copied';

/** How long the result of "Copy ARN" stays beside the button. */
const COPY_RESULT_MS = 3_000;

/** A topic's name keeps room for 24 characters (`aws-area.md`, entry 4). */
const NAME_MIN_WIDTH = '28ch';

type BodyState =
  { kind: 'loading' } | { kind: 'rows' } | { kind: 'empty' } | { kind: 'failure'; failure: ReadFailureState };

function bodyState(listing: Listing<string>, connection: AreaConnection): BodyState {
  if (listing.failure !== undefined) {
    return { kind: 'failure', failure: readFailureState(listing.failure, connection, 'topic list') };
  }
  if (listing.items === undefined) {
    return { kind: 'loading' };
  }
  return listing.items.length > 0 ? { kind: 'rows' } : { kind: 'empty' };
}

interface Row {
  arn: string;
  name: string;
}

/** The header's counter: the page's rows, with a plus while a next page follows ("(100+)"). */
function counterText(rows: number, openEnd: boolean): string {
  return `(${String(rows)}${openEnd ? '+' : ''})`;
}

/**
 * `/aws/sns` and `/aws/sns/topics`. A failed read, or a list shown while the connection was not connected, is read
 * again by itself once the connection is connected again, so after an emulator restart it shows the empty emulator.
 */
export function TopicListPage({ connection }: { connection: AreaConnection }) {
  useShowsResources('topics');
  const handleFollow = useFollow();
  const [announcement, announce] = useAnnouncer();
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
  const removeTopic = useDeleteTopic(connection.engineOrigin);
  const deleteRef = useRef<ButtonProps.Ref>(null);
  const [selectedArn, setSelectedArn] = useState<string>();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const listing = useTopicListing(connection.engineOrigin);
  const { items, refresh, currentPage, goToPage } = listing;
  const loaded = items !== undefined && !listing.loading;
  const state = bodyState(listing, connection);

  const startListing = useCallback(() => {
    setSelectedArn(undefined);
    refresh();
  }, [refresh]);

  const handleRetry = useCallback(() => {
    setSelectedArn(undefined);
    goToPage(currentPage);
  }, [goToPage, currentPage]);

  // Kept from the previous render, as React's own pattern for it, so each change is acted on once.
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

  const rows: Row[] = (items ?? []).map((arn) => ({ arn, name: topicName(arn) }));
  const selected = loaded ? rows.find((row) => row.arn === selectedArn) : undefined;

  // "Copy ARN": the selected topic's ARN as the emulator returned it; calls nothing.
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
  const handleCopyArn = () => {
    if (selected === undefined) {
      return;
    }
    const report = (ok: boolean) => {
      setCopyResult((current) => ({ ok, id: (current?.id ?? 0) + 1 }));
      announce(ok ? ARN_COPIED : ARN_NOT_COPIED);
    };
    // The clipboard is missing outside a secure context.
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (clipboard === undefined) {
      report(false);
      return;
    }
    clipboard.writeText(selected.arn).then(
      () => {
        report(true);
      },
      () => {
        report(false);
      },
    );
  };

  const handleRefresh = () => {
    setRefreshing(true);
    startListing();
  };

  const handlePageChange = ({ detail }: { detail: { currentPageIndex: number } }) => {
    setSelectedArn(undefined);
    goToPage(detail.currentPageIndex);
  };

  const handleDelete = () => {
    if (selected === undefined) {
      return;
    }
    const { arn, name } = selected;
    const lastOnPage = rows.length === 1 && currentPage > 1;
    const signal = pageSignal();
    setDeleting(true);
    removeTopic(arn, signal).then(
      () => {
        if (signal.aborted) {
          return;
        }
        setDeleting(false);
        setDeleteOpen(false);
        setSelectedArn(undefined);
        // The page shown is then empty: the list is read again from its first page.
        if (lastOnPage) {
          refresh();
        }
        flash.show([{ type: 'success', content: `Deleted topic ${name}` }]);
        deleteRef.current?.focus();
      },
      (error: unknown) => {
        if (signal.aborted) {
          return;
        }
        setDeleting(false);
        setDeleteOpen(false);
        flash.show([
          actionFailureItem(failureOf(error, OPERATIONS.deleteTopic), `Delete topic ${name}`, connection.engineOrigin),
        ]);
      },
    );
  };

  const columns: TableProps.ColumnDefinition<Row>[] = [
    {
      id: 'name',
      header: 'Name',
      isRowHeader: true,
      minWidth: NAME_MIN_WIDTH,
      cell: (row) => (
        <Link href={topicHref(row.arn)} onFollow={handleFollow}>
          <ValueText kind="name" value={row.name} />
        </Link>
      ),
    },
    { id: 'type', header: 'Type', cell: (row) => <ValueText kind="fixed" value={topicType(row.name)} /> },
    { id: 'arn', header: 'ARN', cell: (row) => <ValueText kind="address" value={row.arn} /> },
  ];

  const createButton = (
    <Button variant="primary" href={CREATE_TOPIC_PATH} onFollow={handleFollow}>
      Create topic
    </Button>
  );

  let empty = null;
  if (state.kind === 'empty') {
    empty = (
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            No topics
          </Box>
          <Box variant="p" color="inherit">
            The emulator holds no topic yet.
          </Box>
        </SpaceBetween>
        <Box margin={{ top: 's' }}>
          <Button href={CREATE_TOPIC_PATH} onFollow={handleFollow}>
            Create topic
          </Button>
        </Box>
      </Box>
    );
  } else if (state.kind === 'failure') {
    empty = <ReadFailure state={state.failure} onRetry={handleRetry} />;
  }

  return (
    <>
      <Table<Row>
        variant="full-page"
        items={rows}
        trackBy="arn"
        selectionType="single"
        selectedItems={selected === undefined ? [] : [selected]}
        onSelectionChange={({ detail }) => {
          setSelectedArn(detail.selectedItems[0]?.arn);
        }}
        ariaLabels={{
          selectionGroupLabel: 'Topic selection',
          itemSelectionLabel: (_, row) => row.name,
        }}
        columnDefinitions={columns}
        wrapLines
        loading={state.kind === 'loading'}
        loadingText="Loading topics"
        empty={empty}
        header={
          <Header
            variant="awsui-h1-sticky"
            counter={items === undefined ? undefined : counterText(items.length, listing.openEnd)}
            description={DESCRIPTION}
            actions={
              <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                <Button
                  iconName="refresh"
                  ariaLabel="Refresh"
                  disabled={listing.loading}
                  disabledReason={READING}
                  onClick={handleRefresh}
                />
                {copyResult !== undefined && (
                  <StatusIndicator type={copyResult.ok ? 'success' : 'error'}>
                    {copyResult.ok ? ARN_COPIED : ARN_NOT_COPIED}
                  </StatusIndicator>
                )}
                <Button
                  iconName="copy"
                  disabled={selected === undefined}
                  disabledReason={SELECT_FIRST}
                  onClick={handleCopyArn}
                >
                  Copy ARN
                </Button>
                <Button
                  ref={deleteRef}
                  disabled={selected === undefined}
                  disabledReason={SELECT_FIRST}
                  onClick={() => {
                    setDeleteOpen(true);
                  }}
                >
                  Delete
                </Button>
                {createButton}
              </SpaceBetween>
            }
          >
            {TOPICS_TITLE}
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
      {selected !== undefined && (
        <DeleteTopicDialog
          visible={deleteOpen}
          name={selected.name}
          pending={deleting}
          onConfirm={handleDelete}
          onDismiss={() => {
            setDeleteOpen(false);
          }}
        />
      )}
      {announcement}
    </>
  );
}
