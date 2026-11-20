import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import TextFilter from '@cloudscape-design/components/text-filter';
import { useCallback, useState } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import { readFailureState, ReadFailure, useAnnouncer, type ReadFailureState } from '../../../components/failure-states';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import type { TokenListing } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import { useFamilyListing } from '../definition-queries';
import { familyHref, REGISTER_PATH, REGISTER_TITLE, TASK_DEFINITIONS_TITLE, TASK_DEFINITIONS_WORD } from '../format';

// The task definitions, S7 (issue 575, design task 4): the active families, a page of `ListTaskDefinitionFamilies`
// at a time on the API's own tokens, in the API's order. The filter is the API's `familyPrefix`, sent once the text
// has settled.

const FILTER_LABEL = 'Family name starts with';

/** A name keeps room for 24 characters (`aws-area.md`, entry 4): 28ch is those 24 and the cell's padding on each side. */
const NAME_MIN_WIDTH = '28ch';

type BodyState =
  | { kind: 'loading' }
  | { kind: 'rows' }
  | { kind: 'empty' }
  | { kind: 'no-match' }
  | { kind: 'past-end' }
  | { kind: 'failure'; failure: ReadFailureState };

function bodyState(listing: TokenListing<string>, connection: AreaConnection, filtered: boolean): BodyState {
  if (listing.failure !== undefined) {
    return { kind: 'failure', failure: readFailureState(listing.failure, connection, 'task definition list') };
  }
  if (listing.items === undefined) {
    return { kind: 'loading' };
  }
  if (listing.items.length > 0) {
    return { kind: 'rows' };
  }
  if (listing.pastEnd) {
    return { kind: 'past-end' };
  }
  return filtered ? { kind: 'no-match' } : { kind: 'empty' };
}

/** The header's counter: the page's rows, with a plus while a next page follows ("(25+)"). */
function counterText(rows: number, openEnd: boolean): string {
  return `(${String(rows)}${openEnd ? '+' : ''})`;
}

/**
 * `/aws/ecs/task-definitions`. A failed read, or a list shown while the connection was not connected, is read again
 * by itself once the connection is connected again.
 */
export function DefinitionListPage({ connection }: { connection: AreaConnection }) {
  useShowsResources(TASK_DEFINITIONS_WORD);
  const handleFollow = useFollow();
  const [announcement, announce] = useAnnouncer();
  const [prefixText, setPrefixText] = useState('');
  const [prefix, setPrefix] = useState('');

  const listing = useFamilyListing(connection.engineOrigin, prefix);
  const { items, refresh, currentPage, goToPage } = listing;
  const state = bodyState(listing, connection, prefix !== '');
  const loaded = items !== undefined;

  const handleRetry = useCallback(() => {
    refresh();
  }, [refresh]);

  // Kept from the previous render, as React's own pattern for it, so each change is acted on once.
  const failureLine = state.kind === 'failure' ? state.failure.firstText : undefined;
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

  const handleClearFilter = () => {
    setPrefixText('');
    setPrefix('');
  };

  const columns: TableProps.ColumnDefinition<string>[] = [
    {
      id: 'family',
      header: 'Family',
      isRowHeader: true,
      minWidth: NAME_MIN_WIDTH,
      cell: (family) => (
        <Link href={familyHref(family)} onFollow={handleFollow}>
          <ValueText kind="name" value={family} />
        </Link>
      ),
    },
  ];

  let empty = null;
  if (state.kind === 'empty') {
    empty = (
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            No task definitions
          </Box>
          <Box variant="p" color="inherit">
            Register one, or make one with the AWS CLI or an IaC tool pointed at the local emulator.
          </Box>
        </SpaceBetween>
        <Box margin={{ top: 's' }}>
          <Button href={REGISTER_PATH} onFollow={handleFollow}>
            {REGISTER_TITLE}
          </Button>
        </Box>
      </Box>
    );
  } else if (state.kind === 'no-match') {
    empty = (
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            No families match
          </Box>
          <Box variant="p" color="inherit">
            No active family&apos;s name starts with <ValueText kind="name" value={prefix} />.
          </Box>
        </SpaceBetween>
        <Box margin={{ top: 's' }}>
          <Button onClick={handleClearFilter}>Clear filter</Button>
        </Box>
      </Box>
    );
  } else if (state.kind === 'past-end') {
    empty = (
      <Box textAlign="center" color="inherit">
        <Box variant="strong" color="inherit">
          No more families
        </Box>
      </Box>
    );
  } else if (state.kind === 'failure') {
    empty = <ReadFailure state={state.failure} onRetry={handleRetry} />;
  }

  return (
    <>
      <Table<string>
        variant="full-page"
        items={items ?? []}
        trackBy={(family) => family}
        columnDefinitions={columns}
        wrapLines
        loading={state.kind === 'loading'}
        loadingText="Loading task definitions"
        empty={empty}
        filter={
          <TextFilter
            filteringText={prefixText}
            filteringPlaceholder={FILTER_LABEL}
            filteringAriaLabel={FILTER_LABEL}
            filteringClearAriaLabel="Clear the family name filter"
            onChange={({ detail }) => {
              setPrefixText(detail.filteringText);
            }}
            onDelayedChange={({ detail }) => {
              if (detail.filteringText !== prefix) {
                setPrefix(detail.filteringText);
              }
            }}
          />
        }
        header={
          <Header
            variant="awsui-h1-sticky"
            counter={items === undefined ? undefined : counterText(items.length, listing.openEnd)}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" loading={listing.loading} onClick={refresh} />
                <Button variant="primary" href={REGISTER_PATH} onFollow={handleFollow}>
                  {REGISTER_TITLE}
                </Button>
              </SpaceBetween>
            }
          >
            {TASK_DEFINITIONS_TITLE}
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
            onChange={({ detail }) => {
              goToPage(detail.currentPageIndex);
            }}
          />
        }
      />
      {announcement}
    </>
  );
}
