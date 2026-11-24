import type { ParameterMetadata } from '@aws-sdk/client-ssm';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table from '@cloudscape-design/components/table';
import { useEffect, useState } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import { ReadFailure, readFailureState } from '../../../components/failure-states';
import { creationDateText } from '../../../components/format-date';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import { DeleteControl } from '../components/delete/delete-control';
import { PARAMETER_CREATE_PATH, parameterPath } from '../paths';
import { useParameterListing } from '../queries';

export function ParameterListPage({ connection }: { connection: AreaConnection }) {
  useShowsResources('parameters');
  const handleFollow = useFollow();
  const listing = useParameterListing(connection);
  const { failure, rememberFailure } = listing;
  const unavailable = failure?.kind === 'not-implemented';
  useEffect(() => {
    if (failure?.kind === 'not-implemented') rememberFailure(failure);
  }, [failure, rememberFailure]);

  const [selection, setSelection] = useState<{ key: string; items: readonly ParameterMetadata[] }>();
  const selectedItems = failure === undefined && selection?.key === listing.selectionKey ? selection.items : [];
  const selectedNames = selectedItems.flatMap(({ Name }) => (Name ? [Name] : []));
  const state = failure === undefined ? undefined : readFailureState(failure, connection, 'parameters');
  const empty = (
    <Box textAlign="center">
      <SpaceBetween size="xs">
        <Box variant="strong">
          {listing.pastEnd || listing.openEnd ? 'No parameters on this page' : 'No parameters'}
        </Box>
        {!listing.pastEnd && !listing.openEnd && (
          <Box variant="p">Create a parameter to store a configuration value.</Box>
        )}
      </SpaceBetween>
    </Box>
  );

  return (
    <Table<ParameterMetadata>
      variant="full-page"
      columnDefinitions={[
        {
          id: 'name',
          header: 'Name',
          isRowHeader: true,
          minWidth: '28ch',
          cell: ({ Name }) =>
            Name ? (
              <Link href={parameterPath(Name)} onFollow={handleFollow}>
                <span style={Name.length <= 24 ? { display: 'inline-block', minWidth: 'max-content' } : undefined}>
                  <ValueText kind="name" value={Name} />
                </span>
              </Link>
            ) : (
              '-'
            ),
        },
        { id: 'type', header: 'Type', cell: ({ Type }) => Type ?? '-' },
        { id: 'version', header: 'Version', cell: ({ Version }) => Version ?? '-' },
        {
          id: 'modified',
          header: 'Last modified',
          cell: ({ LastModifiedDate }) => <ValueText kind="fixed" value={creationDateText(LastModifiedDate)} />,
        },
      ]}
      items={failure === undefined ? (listing.items ?? []) : []}
      trackBy={(parameter) => parameter.Name ?? parameter.ARN ?? ''}
      wrapLines
      selectionType="multi"
      selectedItems={selectedItems}
      isItemDisabled={(parameter) => !parameter.Name}
      ariaLabels={{
        selectionGroupLabel: 'Parameters',
        allItemsSelectionLabel: () => 'Select all parameters on this page',
        itemSelectionLabel: (_, item) => `Select ${item.Name ?? 'parameter'}`,
      }}
      onSelectionChange={({ detail }) => setSelection({ key: listing.selectionKey, items: detail.selectedItems })}
      loading={failure === undefined && listing.loading}
      loadingText="Loading parameters…"
      empty={
        state === undefined ? (
          empty
        ) : unavailable ? (
          <Box textAlign="center">
            <SpaceBetween size="xs">
              <StatusIndicator type={state.type}>{state.first}</StatusIndicator>
              <Box variant="p">{state.detail}</Box>
              <Button disabled>Retry</Button>
            </SpaceBetween>
          </Box>
        ) : (
          <ReadFailure state={state} onRetry={listing.refresh} />
        )
      }
      header={
        <Header
          variant="awsui-h1-sticky"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button iconName="refresh" ariaLabel="Refresh" disabled={unavailable} onClick={listing.refresh} />
              <DeleteControl
                key={listing.generation}
                names={selectedNames}
                connection={connection}
                disabled={listing.disconnected || failure !== undefined}
                onSettled={() => setSelection(undefined)}
              />
              <Button variant="primary" href={PARAMETER_CREATE_PATH} onFollow={handleFollow}>
                Create parameter
              </Button>
            </SpaceBetween>
          }
        >
          Parameter Store
        </Header>
      }
      pagination={
        (listing.openEnd || listing.pagesCount > 1) && (
          <Pagination
            currentPageIndex={listing.currentPage}
            pagesCount={listing.pagesCount}
            openEnd={listing.openEnd}
            disabled={unavailable || listing.loading || listing.disconnected}
            ariaLabels={{
              nextPageLabel: 'Next page',
              previousPageLabel: 'Previous page',
              pageLabel: (page) => `Page ${String(page)}`,
            }}
            onChange={({ detail }) => {
              setSelection(undefined);
              listing.goToPage(detail.currentPageIndex);
            }}
          />
        )
      }
    />
  );
}
