import type { LogStream } from '@aws-sdk/client-cloudwatch-logs';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import Table from '@cloudscape-design/components/table';
import TextFilter from '@cloudscape-design/components/text-filter';
import { useEffect, useState } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import { readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import { creationDateText } from '../../../components/format-date';
import { useFollow } from '../../../components/use-follow';
import { useTokenListing } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import { logStreamPath } from '../format';
import { DESCRIBE_LOG_STREAMS, listLogStreams } from '../stream-api';

function dateCell(time: number | undefined) {
  return <ValueText kind="fixed" value={creationDateText(time === undefined ? undefined : new Date(time))} />;
}

export function StreamSection({ connection, group }: { connection: AreaConnection; group: string }) {
  const follow = useFollow();
  const [announcement, announce] = useAnnouncer();
  const [filterText, setFilterText] = useState('');
  const [prefix, setPrefix] = useState('');
  const listing = useTokenListing({
    key: ['logs', 'streams', group, prefix],
    endpoint: connection.engineOrigin,
    operation: DESCRIBE_LOG_STREAMS,
    read: (endpoint, token, signal) => listLogStreams(endpoint, group, prefix, token, signal),
  });
  const failure = listing.failure && readFailureState(listing.failure, connection, 'log stream list');
  const message = failure?.firstText;

  useEffect(() => {
    announce(message ?? '');
  }, [announce, message]);

  return (
    <>
      <Table<LogStream>
        items={listing.items ?? []}
        trackBy="logStreamName"
        wrapLines
        loading={listing.loading}
        loadingText="Loading log streams"
        header={
          <Header
            variant="h2"
            actions={
              <Button
                ariaLabel="Refresh log streams"
                iconName="refresh"
                loading={listing.loading}
                onClick={listing.refresh}
              />
            }
          >
            Log streams
          </Header>
        }
        columnDefinitions={[
          {
            id: 'name',
            header: 'Log stream name',
            isRowHeader: true,
            minWidth: '28ch',
            cell: ({ logStreamName }) =>
              logStreamName === undefined ? (
                '-'
              ) : (
                <Link href={logStreamPath(group, logStreamName)} onFollow={follow}>
                  <ValueText kind="name" value={logStreamName} />
                </Link>
              ),
          },
          {
            id: 'last-event',
            header: 'Last event time',
            cell: ({ lastEventTimestamp }) => dateCell(lastEventTimestamp),
          },
          {
            id: 'first-event',
            header: 'First event time',
            cell: ({ firstEventTimestamp }) => dateCell(firstEventTimestamp),
          },
          { id: 'creation-time', header: 'Creation time', cell: ({ creationTime }) => dateCell(creationTime) },
        ]}
        filter={
          <FormField label="Filter by prefix" description="Streams that start with the prefix are listed by name.">
            <TextFilter
              filteringText={filterText}
              filteringClearAriaLabel="Clear the prefix filter"
              onChange={({ detail }) => setFilterText(detail.filteringText)}
              onDelayedChange={({ detail }) => setPrefix(detail.filteringText)}
            />
          </FormField>
        }
        pagination={
          <Pagination
            currentPageIndex={listing.currentPage}
            pagesCount={listing.pagesCount}
            openEnd={listing.openEnd}
            disabled={listing.loading}
            ariaLabels={{
              nextPageLabel: 'Next page',
              previousPageLabel: 'Previous page',
              pageLabel: (page) => `Page ${String(page)}`,
            }}
            onChange={({ detail }) => listing.goToPage(detail.currentPageIndex)}
          />
        }
        empty={
          failure === undefined ? (
            <Box textAlign="center" color="inherit">
              <Box variant="strong" color="inherit">
                {prefix === '' ? 'No log streams' : 'No log streams match'}
              </Box>
            </Box>
          ) : (
            <ReadFailure state={failure} onRetry={listing.refresh} />
          )
        }
      />
      {announcement}
    </>
  );
}
