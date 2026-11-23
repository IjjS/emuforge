import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import TextFilter, { type TextFilterProps } from '@cloudscape-design/components/text-filter';
import { useEffect, useRef, useState } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import { readFailureState, ReadFailure, useAnnouncer, type ReadFailureState } from '../../../components/failure-states';
import { creationDateText } from '../../../components/format-date';
import { useShowsResources } from '../../../components/page-resources';
import { ValueText } from '../../../components/value-text';
import { LIST_STACKS, type StackRow } from '../api';
import { useStackListing } from '../queries';

export const STACKS_TITLE = 'Stacks';
const FILTER_LABEL = 'Filter by stack name';
const LOAD_FAILED = 'Could not load stacks';

const COMPACT_TABLE_WIDTH = 480;

const NAME_COLUMN: TableProps.ColumnDefinition<StackRow> = {
  id: 'name',
  header: 'Stack name',
  isRowHeader: true,
  // A 24-character name can use wide letters such as W. Include the cell's horizontal padding.
  minWidth: 'calc(22.5em + 36px)',
  cell: ({ name }) => <ValueText kind="name" value={name} />,
};

const DETAIL_COLUMNS: TableProps.ColumnDefinition<StackRow>[] = [
  {
    id: 'created',
    header: 'Created',
    minWidth: '20ch',
    cell: ({ created }) => <ValueText kind="fixed" value={creationDateText(created)} />,
  },
  {
    id: 'description',
    header: 'Description',
    minWidth: '20ch',
    cell: ({ description }) => <ValueText kind="text" value={description} none="-" />,
  },
];

const COLUMNS: TableProps.ColumnDefinition<StackRow>[] = [
  NAME_COLUMN,
  {
    id: 'status',
    header: 'Status',
    cell: ({ status }) => <ValueText kind="fixed" value={status} />,
  },
  ...DETAIL_COLUMNS,
];

const COMPACT_COLUMNS: TableProps.ColumnDefinition<StackRow>[] = [
  {
    ...NAME_COLUMN,
    header: 'Stack name and status',
    cell: ({ name, status }) => (
      <>
        <ValueText kind="name" value={name} />
        <Box fontSize="body-s">
          <ValueText kind="fixed" value={status} />
        </Box>
      </>
    ),
  },
  ...DETAIL_COLUMNS,
];

function connectionFailure(connection: AreaConnection): RequestFailure | undefined {
  const { result } = connection;
  switch (result?.kind) {
    case 'emulator-unreachable':
      return { kind: 'emulator-did-not-answer', operation: LIST_STACKS, message: result.message };
    case 'engine-unreachable':
      return { kind: 'engine-did-not-answer', operation: LIST_STACKS };
    case 'engine-error':
      return { kind: 'other', operation: LIST_STACKS, code: result.code ?? `HTTP ${String(result.status)}` };
    default:
      return undefined;
  }
}

function stackReadFailure(failure: RequestFailure, connection: AreaConnection): ReadFailureState {
  const engine = failure.kind === 'engine-did-not-answer';
  if (engine || failure.kind === 'emulator-did-not-answer') {
    const expected = engine ? 'engine-unreachable' : 'emulator-unreachable';
    const useConnection = connection.result?.kind === expected;
    const state = readFailureState(
      failure,
      useConnection ? connection : { ...connection, result: undefined },
      'stacks',
    );
    const recovery = engine
      ? 'Check that the EmuForge engine is running, then retry.'
      : 'Check that the local emulator is running on the configured port, then retry.';
    return {
      ...state,
      detail: (
        <>
          {state.detail}
          {useConnection && failure.kind === 'emulator-did-not-answer' && failure.message !== '' && (
            <> {failure.message}</>
          )}{' '}
          {recovery}
        </>
      ),
    };
  }
  const state = readFailureState(failure, connection, 'stacks');
  return failure.kind === 'other' && !state.recovery ? { ...state, first: LOAD_FAILED, firstText: LOAD_FAILED } : state;
}

function StackListEmpty({
  failure,
  onRetry,
  hasStacks,
  firstPage,
  onClearFilter,
}: {
  failure: ReadFailureState | undefined;
  onRetry: () => void;
  hasStacks: boolean;
  firstPage: boolean;
  onClearFilter: () => void;
}) {
  if (failure?.type === 'info') {
    return (
      <Box textAlign="center">
        <SpaceBetween size="xs">
          <StatusIndicator type="info">{failure.first}</StatusIndicator>
          <Box variant="p">{failure.detail}</Box>
          <Button disabled>Retry</Button>
        </SpaceBetween>
      </Box>
    );
  }
  if (failure !== undefined) {
    return <ReadFailure state={failure} onRetry={onRetry} />;
  }
  return (
    <Box textAlign="center">
      <SpaceBetween size="xs">
        <Box variant="strong">
          {hasStacks ? 'No matching stacks' : firstPage ? 'No stacks' : 'No stacks on this page'}
        </Box>
        {hasStacks ? (
          <Button onClick={onClearFilter}>Clear filter</Button>
        ) : firstPage ? (
          <Box variant="p">Stacks created in this emulator will appear here.</Box>
        ) : null}
      </SpaceBetween>
    </Box>
  );
}

export function StacksPage({ connection }: { connection: AreaConnection }) {
  useShowsResources('stacks');
  const tableSection = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const [tableOverflows, setTableOverflows] = useState(false);
  const [filter, setFilter] = useState('');
  const filterRef = useRef<TextFilterProps.Ref>(null);
  const [generation, setGeneration] = useState(0);
  const listing = useStackListing(connection.engineOrigin, generation);
  const [announcement, announce] = useAnnouncer();

  useEffect(() => {
    const table = tableSection.current?.querySelector('table');
    const scrollPane = table?.parentElement;
    if (!table || !scrollPane) return;

    const measure = () => {
      const width = scrollPane.clientWidth;
      setCompact(width > 0 && width <= COMPACT_TABLE_WIDTH);
      setTableOverflows(scrollPane.scrollWidth > width);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(measure);
    observer.observe(table);
    observer.observe(scrollPane);
    return () => observer.disconnect();
  }, []);

  const disconnected = connectionFailure(connection);
  const connectionKind = connection.result?.kind;
  const [previousKind, setPreviousKind] = useState(connectionKind);
  if (connectionKind !== previousKind) {
    setPreviousKind(connectionKind);
    const readLostConnection =
      listing.failure?.kind === 'engine-did-not-answer' || listing.failure?.kind === 'emulator-did-not-answer';
    if (connectionKind === 'connected' && (previousKind !== undefined || readLostConnection)) {
      setGeneration((current) => current + 1);
    }
  }

  const failure = listing.failure ?? disconnected;
  const state = failure === undefined ? undefined : stackReadFailure(failure, connection);
  const failureText = state?.firstText;
  const [previousFailureText, setPreviousFailureText] = useState(failureText);
  if (failureText !== previousFailureText) {
    setPreviousFailureText(failureText);
    if (failureText !== undefined) announce(failureText);
  }

  const unavailable = failure?.kind === 'not-implemented';
  const stacks = failure === undefined ? listing.items : undefined;
  const term = filter.toLowerCase();
  const rows = (stacks ?? []).filter(({ name }) => name.toLowerCase().includes(term));
  const matchCount =
    stacks === undefined ? '' : `${String(rows.length)} ${rows.length === 1 ? 'match' : 'matches'} on this page`;
  const hasPagination = listing.openEnd || listing.pagesCount > 1;

  const handleRefresh = () => {
    setGeneration((current) => current + 1);
  };
  const handleClearFilter = () => {
    setFilter('');
    filterRef.current?.focus();
  };

  return (
    <div ref={tableSection}>
      <Table<StackRow>
        variant="full-page"
        columnDefinitions={compact ? COMPACT_COLUMNS : COLUMNS}
        items={rows}
        trackBy="id"
        wrapLines
        loading={failure === undefined && listing.loading}
        loadingText="Loading stacks"
        empty={
          <StackListEmpty
            failure={state}
            onRetry={listing.refresh}
            hasStacks={(stacks?.length ?? 0) > 0}
            firstPage={listing.currentPage === 1}
            onClearFilter={handleClearFilter}
          />
        }
        header={
          <Header
            variant="awsui-h1-sticky"
            description={tableOverflows ? 'Scroll sideways to see more columns.' : undefined}
            actions={<Button iconName="refresh" ariaLabel="Refresh" disabled={unavailable} onClick={handleRefresh} />}
          >
            {STACKS_TITLE}
          </Header>
        }
        filter={
          <FormField constraintText="Filters this page only." stretch>
            <TextFilter
              ref={filterRef}
              filteringText={filter}
              filteringPlaceholder={FILTER_LABEL}
              filteringAriaLabel={FILTER_LABEL}
              filteringClearAriaLabel="Clear stack name filter"
              countText={matchCount}
              onChange={({ detail }) => {
                setFilter(detail.filteringText);
              }}
            />
          </FormField>
        }
        pagination={
          hasPagination && (
            <Pagination
              currentPageIndex={listing.currentPage}
              pagesCount={listing.pagesCount}
              openEnd={listing.openEnd}
              disabled={unavailable || disconnected !== undefined || listing.loading}
              ariaLabels={{
                nextPageLabel: 'Next page',
                previousPageLabel: 'Previous page',
                pageLabel: (page) => `Page ${String(page)}`,
              }}
              onChange={({ detail }) => {
                listing.goToPage(detail.currentPageIndex);
              }}
            />
          )
        }
      />
      {announcement}
    </div>
  );
}
