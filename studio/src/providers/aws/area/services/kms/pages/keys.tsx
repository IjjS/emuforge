import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import { useState } from 'react';

import { ReadFailure, readFailureState } from '../../../components/failure-states';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { KMS_OPERATIONS, type CustomerKey } from '../api';
import { keyPath, KEYS_TITLE } from '../paths';
import { KEY_CREATE_PATH } from './create';
import { connectionFailure, useCustomerKeys } from '../queries';

function KeysVisit({ connection }: Pick<ScreenPageProps, 'connection'>) {
  const handleFollow = useFollow();
  const [generation, setGeneration] = useState(0);
  const offline = connectionFailure(connection, KMS_OPERATIONS.listKeys);
  const listing = useCustomerKeys(connection.engineOrigin, offline === undefined || generation > 0, generation);
  const failure = listing.failure ?? (generation === 0 ? offline : undefined);
  const handleRefresh = () => setGeneration((current) => current + 1);

  return (
    <Table<CustomerKey>
      variant="full-page"
      trackBy="id"
      items={listing.items ?? []}
      wrapLines
      columnDefinitions={[
        {
          id: 'alias',
          header: 'Aliases',
          minWidth: '24ch',
          cell: ({ aliases }) =>
            aliases.length === 0 ? (
              '–'
            ) : (
              <SpaceBetween size="xxxs">
                {aliases.map((alias) => (
                  <ValueText key={alias} kind="address" value={alias} />
                ))}
              </SpaceBetween>
            ),
        },
        {
          id: 'key-id',
          header: 'Key ID',
          isRowHeader: true,
          minWidth: '24ch',
          cell: ({ id }) => (
            <Link href={keyPath(id)} onFollow={handleFollow}>
              <ValueText kind="name" value={id} />
            </Link>
          ),
        },
        { id: 'status', header: 'Status', cell: ({ state }) => <ValueText kind="fixed" value={state} none="–" /> },
        {
          id: 'description',
          header: 'Description',
          cell: ({ description }) => <ValueText kind="text" value={description} none="–" />,
        },
      ]}
      loading={listing.loading}
      loadingText="Loading keys…"
      empty={
        failure === undefined ? (
          <Box textAlign="center" variant="strong">
            {listing.openEnd || listing.pagesCount > 1
              ? 'No customer managed keys on this page'
              : 'No customer managed keys'}
          </Box>
        ) : (
          <ReadFailure
            state={readFailureState(failure, connection, `key list (${failure.operation})`)}
            onRetry={offline === undefined ? listing.refresh : handleRefresh}
          />
        )
      }
      header={
        <Header
          variant="awsui-h1-sticky"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button iconName="refresh" ariaLabel="Refresh" onClick={handleRefresh} />
              <Button variant="primary" href={KEY_CREATE_PATH} onFollow={handleFollow}>
                Create key
              </Button>
            </SpaceBetween>
          }
        >
          {KEYS_TITLE}
        </Header>
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
    />
  );
}

export function KeysPage({ connection }: ScreenPageProps) {
  useShowsResources('keys');
  const connected = connection.result === undefined || connection.result.kind === 'connected';
  return <KeysVisit key={JSON.stringify([connection.engineOrigin, connected])} connection={connection} />;
}
