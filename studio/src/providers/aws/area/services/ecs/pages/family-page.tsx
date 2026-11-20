import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useCallback, useState } from 'react';

import { readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { NotFound } from '../components/not-found';
import type { RevisionRow, RevisionStatus } from '../definition-api';
import { useNewestRevision, useRevisionListing, type NewestRevision } from '../definition-queries';
import {
  registerHref,
  revisionHref,
  TASK_DEFINITIONS_PATH,
  TASK_DEFINITIONS_TITLE,
  TASK_DEFINITIONS_WORD,
} from '../format';

// A family, S8 (issue 575, design task 4): its revisions of one status, the newest first, a page of
// `ListTaskDefinitions` at a time on the API's own tokens. "Register new revision" leads from the newest active
// revision: the first row of the active list's first page when that is shown, else a read of its own with
// `maxResults` 1. A family is not found only when both statuses answer none, so the status not shown is read
// (`maxResults` 1) only when the shown one is empty.

const NO_ACTIVE_REASON = 'The family has no active revision.';

const STATUS_OPTIONS: readonly SelectProps.Option[] = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
];

const OTHER: Readonly<Record<RevisionStatus, RevisionStatus>> = { ACTIVE: 'INACTIVE', INACTIVE: 'ACTIVE' };

/** A name keeps room for 24 characters (`aws-area.md`, entry 4): 28ch is those 24 and the cell's padding on each side. */
const NAME_MIN_WIDTH = '28ch';

/** `/aws/ecs/task-definitions/family/{family}`: the family's revisions, read on every opening and refresh. */
export function FamilyPage({ connection, params }: ScreenPageProps) {
  useShowsResources(TASK_DEFINITIONS_WORD);
  const family = params['family'] ?? '';
  const handleFollow = useFollow();
  const [announcement, announce] = useAnnouncer();
  const [status, setStatus] = useState<RevisionStatus>('ACTIVE');
  const endpoint = connection.engineOrigin;

  const listing = useRevisionListing(endpoint, family, status);
  const { items, failure, currentPage, goToPage } = listing;
  const refreshListing = listing.refresh;
  const firstPage = currentPage === 1;
  const shownEmpty = items !== undefined && items.length === 0 && firstPage;

  // The newest active revision: the shown first page of "Active", else its own read.
  const activeShown = status === 'ACTIVE' && firstPage;
  const newestActive = useNewestRevision(endpoint, family, 'ACTIVE', !activeShown);
  // The status not shown, read only to tell an empty status from a family with no revision at all.
  const otherIsActive = OTHER[status] === 'ACTIVE';
  const otherInactive = useNewestRevision(endpoint, family, 'INACTIVE', shownEmpty && !otherIsActive);
  const other = otherIsActive ? newestActive : otherInactive;

  let newest: NewestRevision | undefined;
  if (activeShown) {
    newest = items === undefined ? undefined : (items[0] ?? null);
  } else {
    newest = newestActive.value;
  }
  const notFound = shownEmpty && other.value === null;

  const refreshNewest = newestActive.refresh;
  const refreshOther = otherInactive.refresh;
  const readAgain = useCallback(() => {
    refreshListing();
    refreshNewest();
    refreshOther();
  }, [refreshListing, refreshNewest, refreshOther]);

  const failureState = failure === undefined ? undefined : readFailureState(failure, connection, 'revisions');
  const otherFailure =
    shownEmpty && other.failure !== undefined ? readFailureState(other.failure, connection, 'revisions') : undefined;

  // Kept from the previous render, as React's own pattern for it, so each change is acted on once.
  const failureLine = failureState?.firstText ?? otherFailure?.firstText;
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
    if (connected && (failureLine !== undefined || wasDown)) {
      setWasDown(false);
      readAgain();
    }
  }

  const columns: TableProps.ColumnDefinition<RevisionRow>[] = [
    {
      id: 'revision',
      header: 'Revision',
      isRowHeader: true,
      minWidth: NAME_MIN_WIDTH,
      cell: (row) => (
        <Link href={revisionHref(row.family, row.revision)} onFollow={handleFollow}>
          <ValueText kind="name" value={row.value} />
        </Link>
      ),
    },
  ];

  let empty = null;
  if (failureState !== undefined) {
    empty = <ReadFailure state={failureState} onRetry={refreshListing} />;
  } else if (otherFailure !== undefined) {
    empty = <ReadFailure state={otherFailure} onRetry={other.refresh} />;
  } else if (items !== undefined && items.length === 0) {
    const word = listing.pastEnd ? 'No more' : status === 'ACTIVE' ? 'No active' : 'No inactive';
    empty = (
      <Box textAlign="center" color="inherit">
        <Box variant="strong" color="inherit">
          {word} revisions
        </Box>
      </Box>
    );
  }

  const content = notFound ? (
    <NotFound
      heading={`No family named ${family}`}
      statement="The local emulator has no task definition of this family."
      link={{ text: TASK_DEFINITIONS_TITLE, href: TASK_DEFINITIONS_PATH }}
    />
  ) : (
    <Table<RevisionRow>
      variant="container"
      items={items ?? []}
      trackBy="value"
      columnDefinitions={columns}
      wrapLines
      loading={failureState === undefined && (items === undefined || (shownEmpty && other.loading))}
      loadingText="Loading revisions"
      empty={empty}
      filter={
        // In a horizontal SpaceBetween the select keeps the width of its two options, not the container's.
        <SpaceBetween direction="horizontal" size="xs">
          <Select
            inlineLabelText="Status"
            selectedOption={STATUS_OPTIONS.find((option) => option.value === status) ?? null}
            options={STATUS_OPTIONS}
            onChange={({ detail }) => {
              const value = detail.selectedOption.value;
              if (value === 'ACTIVE' || value === 'INACTIVE') {
                setStatus(value);
              }
            }}
          />
        </SpaceBetween>
      }
      header={<Header variant="h2">Revisions</Header>}
      pagination={
        <Pagination
          currentPageIndex={currentPage}
          pagesCount={listing.pagesCount}
          openEnd={listing.openEnd}
          disabled={items === undefined}
          ariaLabels={{
            nextPageLabel: 'Next page of revisions',
            previousPageLabel: 'Previous page of revisions',
            pageLabel: (page) => `Page ${String(page)} of revisions`,
          }}
          onChange={({ detail }) => {
            goToPage(detail.currentPageIndex);
          }}
        />
      }
    />
  );

  return (
    <>
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" loading={listing.loading} onClick={readAgain} />
                <Button
                  variant="primary"
                  disabled={newest === undefined || newest === null}
                  {...(newest === null ? { disabledReason: NO_ACTIVE_REASON } : {})}
                  {...(newest === undefined || newest === null ? {} : { href: registerHref(newest) })}
                  onFollow={handleFollow}
                >
                  Register new revision
                </Button>
              </SpaceBetween>
            }
          >
            <ValueText kind="name" value={family} />
          </Header>
        }
      >
        {content}
      </ContentLayout>
      {announcement}
    </>
  );
}
