import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import Pagination from '@cloudscape-design/components/pagination';
import Table, { type TableProps } from '@cloudscape-design/components/table';

import type { AreaConnection } from '../../../components/emulator-line';
import { ReadFailure, readFailureState } from '../../../components/failure-states';
import { creationDateText } from '../../../components/format-date';
import type { TokenListing } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import type { AlarmHistoryItem } from '../alarm-page-api';

const columns: TableProps.ColumnDefinition<AlarmHistoryItem>[] = [
  {
    id: 'time',
    header: 'Time',
    cell: ({ time }) => <ValueText kind="fixed" value={creationDateText(time)} />,
  },
  {
    id: 'type',
    header: 'Type',
    cell: ({ type }) => <ValueText kind="fixed" value={type} none="-" />,
  },
  {
    id: 'summary',
    header: 'Summary',
    cell: ({ summary }) => <ValueText kind="text" value={summary} none="-" />,
  },
];

export function AlarmHistory({
  connection,
  listing,
}: {
  connection: AreaConnection;
  listing: TokenListing<AlarmHistoryItem>;
}) {
  const failure = listing.failure && readFailureState(listing.failure, connection, 'history');
  return (
    <Table
      items={listing.items ?? []}
      columnDefinitions={columns}
      wrapLines
      loading={listing.loading}
      loadingText="Loading history"
      header={
        <Header variant="h2" actions={<Button iconName="refresh" ariaLabel="Refresh" onClick={listing.refresh} />}>
          History
        </Header>
      }
      pagination={
        <Pagination
          currentPageIndex={listing.currentPage}
          pagesCount={listing.pagesCount}
          openEnd={listing.openEnd}
          disabled={listing.loading}
          ariaLabels={{
            nextPageLabel: 'Next history page',
            previousPageLabel: 'Previous history page',
            pageLabel: (page) => `History page ${String(page)}`,
          }}
          onChange={({ detail }) => listing.goToPage(detail.currentPageIndex)}
        />
      }
      empty={
        failure ? (
          <ReadFailure state={failure} onRetry={listing.refresh} />
        ) : (
          <Box textAlign="center" color="inherit">
            {listing.pastEnd ? 'No more history' : 'No history'}
          </Box>
        )
      }
    />
  );
}
