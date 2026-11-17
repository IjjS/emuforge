import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import CollectionPreferences, {
  type CollectionPreferencesProps,
} from '@cloudscape-design/components/collection-preferences';
import Header from '@cloudscape-design/components/header';
import HelpPanel from '@cloudscape-design/components/help-panel';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator, { type StatusIndicatorProps } from '@cloudscape-design/components/status-indicator';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import Tabs, { type TabsProps } from '@cloudscape-design/components/tabs';
import TextFilter, { type TextFilterProps } from '@cloudscape-design/components/text-filter';
import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import '../../../styles/emulator-line.css';
import { AreaRootContext } from '../../../area-root';
import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import { usePageHelp } from '../../../components/page-help';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { LIST_BUCKETS, type Bucket, type ReadFailure } from '../api';
import {
  bucketPath,
  BUCKETS_PATH,
  CREATE_BUCKET_PATH,
  deleteBucketPath,
  DIRECTORY_BUCKETS_PATH,
  emptyBucketPath,
} from '../format';
import { useBucketListing, type BucketCount, type BucketListing } from '../queries';
import { regionText } from '../regions';

// S3's general purpose bucket list (issue 56, requirement R3 to R8): the console's "Buckets" page with the tab
// "General purpose buckets", in the console's words; its description, help and states in EmuForge's own. Every value
// from the engine or the emulator is rendered as text.

/** The page's title, its `h1`. */
export const BUCKETS_TITLE = 'Buckets';

const TABLE_TITLE = 'General purpose buckets';
const SELECT_FIRST = 'Select a bucket first';
const NO_ARN = 'The emulator returned no ARN for this bucket';
const NOT_READ = 'The bucket list could not be read.';
const REFRESHED = 'Bucket list refreshed';
const ARN_COPIED = 'ARN copied';
const ARN_NOT_COPIED = "Couldn't copy the ARN";

/** How long the result of "Copy ARN" stays beside the button. */
const COPY_RESULT_MS = 3_000;

/** The page size and "Wrap lines" at the start of every visit (R4.8); stored nowhere. */
const START_PREFERENCES = { pageSize: 25, wrapLines: true };

const PAGE_SIZES = [10, 25, 50] as const;

/**
 * The emulator line's status for a connection, in the same words and with the same Cloudscape status type
 * (`studio/AGENTS.md`, "The emulator line"): the status a failed read repeats while the connection is not connected
 * (requirement R7). `undefined` while the line says "Checking" or connected.
 */
interface ConnectionStatus {
  type: StatusIndicatorProps.Type;
  before: string;
  value: string;
  after?: string;
}

function connectionStatus({ result, engineOrigin }: AreaConnection): ConnectionStatus | undefined {
  switch (result?.kind) {
    case undefined:
    case 'connected':
      return undefined;
    case 'emulator-unreachable':
      return result.reason === 'not_started'
        ? { type: 'stopped', before: 'Not started on port ', value: String(result.emulator.port) }
        : { type: 'error', before: 'Not answering at ', value: result.emulator.endpoint };
    case 'engine-unreachable':
      return engineOrigin === undefined
        ? undefined
        : { type: 'error', before: 'The EmuForge engine at ', value: engineOrigin, after: ' is not answering' };
    case 'engine-error':
      return result.code === undefined
        ? { type: 'error', before: 'The EmuForge engine answered with HTTP status ', value: String(result.status) }
        : { type: 'error', before: 'The EmuForge engine answered with an error: ', value: result.code };
  }
}

/** What the table's body shows (R7), the rows aside. */
type BodyState =
  | { kind: 'loading' }
  | { kind: 'rows' }
  | { kind: 'empty' }
  | { kind: 'no-match'; prefix: string }
  | {
      kind: 'failure';
      type: StatusIndicatorProps.Type;
      /** The first line, as shown and as announced. */
      first: ReactNode;
      firstText: string;
      /** What follows it: the sentence of the state, or the message as it came. */
      detail: ReactNode;
      /** The link "Connection status", in the "not connected" state. */
      recovery: boolean;
    };

function Code({ children }: { children: ReactNode }) {
  return (
    <Box variant="code" display="inline">
      {children}
    </Box>
  );
}

/**
 * The state of a failed read (R7), tried top to bottom: the answer's own meaning first, then the connection, then the
 * kinds of failure while the line says connected or "Checking".
 */
function failureState(failure: ReadFailure, connection: AreaConnection): BodyState {
  if (failure.kind === 'not-implemented') {
    return {
      kind: 'failure',
      type: 'info',
      first: 'Not implemented by the emulator',
      firstText: 'Not implemented by the emulator',
      detail: `The emulator answered 501 Not Implemented for ${failure.operation}, so Studio cannot list buckets.`,
      recovery: false,
    };
  }
  if (failure.kind === 'access-denied') {
    return {
      kind: 'failure',
      type: 'error',
      first: 'Access denied',
      firstText: 'Access denied',
      detail: `${LIST_BUCKETS} was refused: ${failure.message}`,
      recovery: false,
    };
  }
  const status = connectionStatus(connection);
  if (status !== undefined) {
    return {
      kind: 'failure',
      type: status.type,
      first: (
        <>
          {status.before}
          <Code>{status.value}</Code>
          {status.after}
        </>
      ),
      firstText: `${status.before}${status.value}${status.after ?? ''}`,
      detail: NOT_READ,
      recovery: true,
    };
  }
  switch (failure.kind) {
    case 'emulator-did-not-answer':
      return {
        kind: 'failure',
        type: 'error',
        first: 'The emulator did not answer',
        firstText: 'The emulator did not answer',
        detail: failure.message,
        recovery: false,
      };
    case 'engine-did-not-answer': {
      const origin = connection.engineOrigin ?? '';
      return {
        kind: 'failure',
        type: 'error',
        first: (
          <>
            The EmuForge engine at <Code>{origin}</Code> did not answer
          </>
        ),
        firstText: `The EmuForge engine at ${origin} did not answer`,
        detail: undefined,
        recovery: false,
      };
    }
    case 'other':
      return {
        kind: 'failure',
        type: 'error',
        first: 'The bucket list could not be read',
        firstText: 'The bucket list could not be read',
        detail:
          failure.message === undefined ? (
            <Code>{failure.code}</Code>
          ) : (
            <>
              <Code>{failure.code}</Code>: {failure.message}
            </>
          ),
        recovery: false,
      };
  }
}

function bodyState(listing: BucketListing, connection: AreaConnection): BodyState {
  if (listing.failure !== undefined) {
    return failureState(listing.failure, connection);
  }
  if (listing.buckets === undefined) {
    return { kind: 'loading' };
  }
  if (listing.buckets.length > 0) {
    return { kind: 'rows' };
  }
  return listing.prefix === '' ? { kind: 'empty' } : { kind: 'no-match', prefix: listing.prefix };
}

function counterText(count: BucketCount): string {
  return `(${String(count.total)}${count.more ? '+' : ''})`;
}

/** "1 match", "2 matches", "25+ matches" (R4.7). */
function matchesText(count: BucketCount): string {
  const total = `${String(count.total)}${count.more ? '+' : ''}`;
  return count.total === 1 && !count.more ? '1 match' : `${total} matches`;
}

/** The control whose use started the listing being read: it stays enabled, so it keeps focus (R7). */
type Starter = 'filter' | 'pagination' | 'preferences' | null;

/** The polite announcements of the page (R6, R7): each one a new element, so the same text is said again. */
function useAnnouncer(): [ReactNode, (text: string) => void] {
  const [said, setSaid] = useState({ text: '', id: 0 });
  const announce = useCallback((text: string) => {
    setSaid((current) => ({ text, id: current.id + 1 }));
  }, []);
  const region = (
    // The area's visually hidden live region, as the emulator line's.
    <div className="aws-area-announcer" aria-live="polite" aria-atomic="true">
      {said.text !== '' && <span key={said.id}>{said.text}</span>}
    </div>
  );
  return [region, announce];
}

/** Cloudscape's modal root for "Preferences" in the area's root, never under `document.body` (`AreaModal`). */
function useAreaModalRoot(): Pick<CollectionPreferencesProps, 'getModalRoot' | 'removeModalRoot'> {
  const root = useContext(AreaRootContext);
  return {
    getModalRoot: () =>
      Promise.resolve().then(() => {
        const area = root.current;
        if (area === null) {
          throw new Error('A modal of the AWS area opened outside the area.');
        }
        const container = document.createElement('div');
        area.appendChild(container);
        return container;
      }),
    removeModalRoot: (container: HTMLElement | null) => {
      container?.remove();
    },
  };
}

interface TableBodyProps {
  state: BodyState;
  onCreate: () => void;
  onClearFilter: () => void;
  onRetry: () => void;
}

/** The table's empty slot: the empty, no-match and failure states (R7), with Cloudscape's empty-table pattern. */
function TableBody({ state, onCreate, onClearFilter, onRetry }: TableBodyProps) {
  const handleFollow = useFollow();
  switch (state.kind) {
    case 'loading':
    case 'rows':
      return null;
    case 'empty':
      return (
        <Box textAlign="center" color="inherit">
          <SpaceBetween size="xxs">
            <Box variant="strong" color="inherit">
              No buckets
            </Box>
            <Box variant="p" color="inherit">
              This emulator holds no general purpose buckets. It starts empty each time it restarts. Create one here, or
              with any tool pointed at the emulator.
            </Box>
          </SpaceBetween>
          <Box margin={{ top: 's' }}>
            <Button onClick={onCreate}>Create bucket</Button>
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
              {`No bucket name starts with “${state.prefix}”.`}
            </Box>
          </SpaceBetween>
          <Box margin={{ top: 's' }}>
            <Button onClick={onClearFilter}>Clear filter</Button>
          </Box>
        </Box>
      );
    case 'failure':
      return (
        <Box textAlign="center" color="inherit">
          <SpaceBetween size="xxs">
            <StatusIndicator type={state.type}>{state.first}</StatusIndicator>
            {state.detail !== undefined && (
              <Box variant="p" color="inherit">
                {state.detail}
              </Box>
            )}
            {state.recovery && (
              <Link href="/" onFollow={handleFollow}>
                Connection status
              </Link>
            )}
          </SpaceBetween>
          <Box margin={{ top: 's' }}>
            <Button onClick={onRetry}>Retry</Button>
          </Box>
        </Box>
      );
  }
}

/** The help panel of the bucket list (R8.5): EmuForge's own words, none of the console's. */
export function BucketListHelp() {
  return (
    <HelpPanel header={<h2>{BUCKETS_TITLE}</h2>}>
      <p>
        This list is read from your local emulator each time you open or refresh it. It shows every general purpose
        bucket the emulator holds, whoever made it.
      </p>
      <h3>This is not AWS</h3>
      <p>
        Nothing here is in an AWS account, and Studio sends nothing to AWS. EmuForge Studio is a stand-alone local tool,
        not an AWS feature.
      </p>
      <h3>Finding a bucket</h3>
      <p>The filter matches names that start with what you type.</p>
      <h3>Actions</h3>
      <p>Copy ARN copies the selected bucket&apos;s ARN.</p>
      <p>Empty, Delete and Create bucket open their own screens.</p>
    </HelpPanel>
  );
}

/**
 * `/aws/s3` and `/aws/s3/buckets`: the emulator's general purpose buckets, read through the engine with `ListBuckets`
 * on every opening and refresh, one page at a time (requirement R4). The table keeps its heading, actions and columns
 * in every state and shows the state in its body (R7). A failed read while the connection is not connected repeats
 * the emulator line's status; once the connection is connected again the list is read again by itself.
 */
export function BucketListPage({ connection }: { connection: AreaConnection }) {
  useShowsResources('buckets');
  const openHelp = usePageHelp();
  const handleFollow = useFollow();
  const navigate = useNavigate();
  const modalRoot = useAreaModalRoot();
  const [announcement, announce] = useAnnouncer();
  const filterRef = useRef<TextFilterProps.Ref>(null);

  const [filter, setFilter] = useState('');
  const [preferences, setPreferences] = useState(START_PREFERENCES);
  const [starter, setStarter] = useState<Starter>(null);
  const listing = useBucketListing({ endpoint: connection.engineOrigin, pageSize: preferences.pageSize, filter });
  const { buckets, refresh } = listing;
  const loaded = buckets !== undefined;
  const state = bodyState(listing, connection);

  // Single selection, by name: kept while a bucket of that name is on the page shown (R4.3).
  const [selectedName, setSelectedName] = useState<string>();
  const selected = buckets?.find((bucket) => bucket.name === selectedName);
  if (selectedName !== undefined && buckets !== undefined && selected === undefined) {
    setSelectedName(undefined);
  }

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
  // "Bucket list refreshed", once the refreshed listing's first page is shown (R6).
  if (refreshing && buckets !== undefined) {
    setRefreshing(false);
    announce(REFRESHED);
  } else if (refreshing && listing.failure !== undefined) {
    setRefreshing(false);
  }
  // A failure state is announced once, with its first line (R7).
  if (failureLine !== seenFailureLine) {
    setSeenFailureLine(failureLine);
    if (failureLine !== undefined) {
      announce(failureLine);
    }
  }
  // Once the connection becomes connected again, a failed read, or a list shown while the connection was not
  // connected, is read again by itself (R7, the restart rule; decisions-needed 19, provisional a).
  if (connected !== seenConnected) {
    setSeenConnected(connected);
    if (connected && (listing.failure !== undefined || wasDown)) {
      setWasDown(false);
      startListing();
    }
  }

  // "Copy ARN": the selected bucket's ARN as the emulator returned it; calls nothing (R6).
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
  const handleCopyArn = useCallback(() => {
    const arn = selected?.arn;
    if (arn === undefined) {
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
    clipboard.writeText(arn).then(
      () => {
        report(true);
      },
      () => {
        report(false);
      },
    );
  }, [selected, announce]);

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

  const handleTabChange = useCallback(
    ({ detail }: { detail: TabsProps.ChangeDetail }) => {
      if (detail.activeTabHref !== undefined) {
        void navigate(detail.activeTabHref);
      }
    },
    [navigate],
  );

  const handleSelection = useCallback(({ detail }: { detail: TableProps.SelectionChangeDetail<Bucket> }) => {
    setSelectedName(detail.selectedItems[0]?.name);
  }, []);

  const result = connection.result;
  const description =
    result?.kind === 'connected' ? (
      <>
        Buckets in your local emulator at <Code>{result.emulator.endpoint}</Code>, not in an AWS account.
      </>
    ) : (
      'Buckets in your local emulator, not in an AWS account.'
    );

  const columns: TableProps.ColumnDefinition<Bucket>[] = [
    {
      id: 'name',
      header: 'Name',
      isRowHeader: true,
      cell: (bucket) => (
        <Link href={bucketPath(bucket.name)} onFollow={handleFollow}>
          {bucket.name}
        </Link>
      ),
    },
    { id: 'region', header: 'AWS Region', cell: (bucket) => regionText(bucket.region) },
    { id: 'creationDate', header: 'Creation date', cell: (bucket) => creationDateText(bucket.creationDate) },
  ];

  const noSelection = selected === undefined;
  const copyDisabledReason = noSelection ? SELECT_FIRST : selected.arn === undefined ? NO_ARN : undefined;
  const count = loaded ? listing.count : undefined;

  const table = (
    <Table<Bucket>
      items={buckets ?? []}
      trackBy="name"
      columnDefinitions={columns}
      selectionType="single"
      selectedItems={selected === undefined ? [] : [selected]}
      onSelectionChange={handleSelection}
      ariaLabels={{
        selectionGroupLabel: 'General purpose bucket selection',
        itemSelectionLabel: (_, bucket) => `Select ${bucket.name}`,
      }}
      wrapLines={preferences.wrapLines}
      loading={state.kind === 'loading'}
      loadingText="Loading buckets"
      empty={
        <TableBody
          state={state}
          onCreate={() => void navigate(CREATE_BUCKET_PATH)}
          onClearFilter={handleClearFilter}
          onRetry={startListing}
        />
      }
      header={
        <Header
          variant="h2"
          counter={count === undefined ? undefined : counterText(count)}
          info={
            <Link variant="info" ariaLabel="Info" onFollow={() => openHelp()}>
              Info
            </Link>
          }
          description={description}
          actions={
            <SpaceBetween direction="horizontal" size="xs" alignItems="center">
              <Button iconName="refresh" ariaLabel="Refresh Buckets" onClick={handleRefresh} />
              {copyResult !== undefined && (
                <StatusIndicator type={copyResult.ok ? 'success' : 'error'}>
                  {copyResult.ok ? ARN_COPIED : ARN_NOT_COPIED}
                </StatusIndicator>
              )}
              <Button
                iconName="copy"
                disabled={copyDisabledReason !== undefined}
                {...(copyDisabledReason === undefined ? {} : { disabledReason: copyDisabledReason })}
                onClick={handleCopyArn}
              >
                Copy ARN
              </Button>
              <Button
                disabled={noSelection}
                disabledReason={SELECT_FIRST}
                onClick={() => {
                  if (selected !== undefined) {
                    void navigate(emptyBucketPath(selected.name));
                  }
                }}
              >
                Empty
              </Button>
              <Button
                disabled={noSelection}
                disabledReason={SELECT_FIRST}
                onClick={() => {
                  if (selected !== undefined) {
                    void navigate(deleteBucketPath(selected.name));
                  }
                }}
              >
                Delete
              </Button>
              <Button variant="primary" onClick={() => void navigate(CREATE_BUCKET_PATH)}>
                Create bucket
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
          filteringPlaceholder="Find buckets by name"
          filteringAriaLabel="Find buckets by name"
          disabled={!loaded && starter !== 'filter'}
          {...(listing.prefix !== '' && count !== undefined && { countText: matchesText(count) })}
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
            options: PAGE_SIZES.map((size) => ({ value: size, label: `${String(size)} buckets` })),
          }}
          wrapLinesPreference={{ label: 'Wrap lines', description: 'Show all of a long name, Region or date' }}
          onConfirm={handlePreferences}
        />
      }
    />
  );

  const tabs: TabsProps.Tab[] = [
    { id: 'general', label: 'General purpose buckets', href: BUCKETS_PATH, content: table },
    { id: 'directory', label: 'Directory buckets', href: DIRECTORY_BUCKETS_PATH },
  ];

  return (
    <SpaceBetween size="s">
      <Header variant="h1">{BUCKETS_TITLE}</Header>
      <div>
        <Tabs tabs={tabs} activeTabId="general" keyboardActivationMode="manual" onChange={handleTabChange} />
        {announcement}
      </div>
    </SpaceBetween>
  );
}
