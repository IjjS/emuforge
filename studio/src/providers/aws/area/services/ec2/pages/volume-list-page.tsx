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
import { NONE } from '../format';
import type { Volume } from '../volume-api';
import { CREATE_VOLUME_PATH, VOLUMES_WORD, volumeHref, volumeSizeText } from '../volume-format';
import { useVolumeListing } from '../volume-queries';

function VolumeListing({
  connection,
  endpoint,
}: Pick<ScreenPageProps, 'connection'> & { endpoint: string | undefined }) {
  const handleFollow = useFollow();
  const [generation, setGeneration] = useState(0);
  const listing = useVolumeListing(endpoint, generation);
  const failure = listing.failure && readFailureState(listing.failure, connection, 'volume list');

  return (
    <Table<Volume>
      variant="full-page"
      trackBy="id"
      items={listing.items ?? []}
      wrapLines
      columnDefinitions={[
        {
          id: 'volume-id',
          header: 'Volume ID',
          isRowHeader: true,
          minWidth: '24ch',
          cell: ({ id }) => (
            <Link href={volumeHref(id)} onFollow={handleFollow}>
              <ValueText kind="name" value={id} />
            </Link>
          ),
        },
        {
          id: 'size',
          header: 'Size',
          cell: ({ size }) => <ValueText kind="fixed" value={volumeSizeText(size)} none={NONE} />,
        },
        { id: 'type', header: 'Type', cell: ({ type }) => <ValueText kind="fixed" value={type} none={NONE} /> },
        {
          id: 'zone',
          header: 'Availability Zone',
          cell: ({ zone }) => <ValueText kind="fixed" value={zone} none={NONE} />,
        },
        { id: 'state', header: 'State', cell: ({ state }) => <ValueText kind="fixed" value={state} none={NONE} /> },
      ]}
      loading={listing.loading}
      loadingText="Loading volumes"
      empty={
        failure === undefined ? (
          <Box textAlign="center" variant="strong">
            {listing.pastEnd ? 'No more volumes' : 'No volumes'}
          </Box>
        ) : (
          <ReadFailure state={failure} onRetry={listing.refresh} />
        )
      }
      header={
        <Header
          variant="awsui-h1-sticky"
          description="Find storage by volume ID and see where it is attached."
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                iconName="refresh"
                ariaLabel="Refresh"
                loading={listing.loading}
                onClick={() => setGeneration((current) => current + 1)}
              />
              <Button variant="primary" href={CREATE_VOLUME_PATH} onFollow={handleFollow}>
                Create volume
              </Button>
            </SpaceBetween>
          }
        >
          Volumes
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

export function VolumeListPage({ connection }: ScreenPageProps) {
  useShowsResources(VOLUMES_WORD);
  const down = connection.result !== undefined && connection.result.kind !== 'connected';
  const endpoint = down ? undefined : connection.engineOrigin;
  return <VolumeListing key={endpoint} connection={connection} endpoint={endpoint} />;
}
