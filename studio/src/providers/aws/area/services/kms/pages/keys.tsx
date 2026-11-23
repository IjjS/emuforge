import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import { useEffect, useRef, useState } from 'react';

import { ReadFailure, readFailureState } from '../../../components/failure-states';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { KMS_OPERATIONS, type CustomerKey } from '../api';
import { KeyState } from '../components/lifecycle/key-state';
import { keyPath, KEYS_TITLE } from '../paths';
import { connectionFailure, useCustomerKeys } from '../queries';
import { KEY_CREATE_PATH } from './create';

const OVERFLOW_HINT = 'Scroll sideways to see all columns.';

function KeysVisit({ connection }: Pick<ScreenPageProps, 'connection'>) {
  const handleFollow = useFollow();
  const [generation, setGeneration] = useState(0);
  const tableSection = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const offline = connectionFailure(connection, KMS_OPERATIONS.listKeys);
  const listing = useCustomerKeys(connection.engineOrigin, offline === undefined || generation > 0, generation);
  const failure = listing.failure ?? (generation === 0 ? offline : undefined);
  const handleRefresh = () => setGeneration((current) => current + 1);
  const hasRows = listing.items !== undefined && listing.items.length > 0;
  const showOverflow = hasRows && overflows;

  useEffect(() => {
    const table = tableSection.current?.querySelector('table');
    const scrollPane = table?.parentElement;
    if (!hasRows || !table || !scrollPane) return;
    const measure = () => setOverflows(scrollPane.scrollWidth > scrollPane.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(table);
    observer.observe(scrollPane);
    return () => observer.disconnect();
  }, [hasRows]);

  return (
    <div ref={tableSection}>
      <Table<CustomerKey>
        variant="full-page"
        ariaLabels={{ tableLabel: showOverflow ? `${KEYS_TITLE}. ${OVERFLOW_HINT}` : KEYS_TITLE }}
        trackBy="id"
        items={listing.items ?? []}
        wrapLines
        columnDefinitions={[
          { id: 'status', header: 'Status', cell: ({ state }) => <KeyState state={state} /> },
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
            description={showOverflow ? OVERFLOW_HINT : undefined}
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
          listing.openEnd || listing.pagesCount > 1 ? (
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
          ) : undefined
        }
      />
    </div>
  );
}

export function KeysPage({ connection }: ScreenPageProps) {
  useShowsResources('keys');
  const connected = connection.result === undefined || connection.result.kind === 'connected';
  return <KeysVisit key={JSON.stringify([connection.engineOrigin, connected])} connection={connection} />;
}
