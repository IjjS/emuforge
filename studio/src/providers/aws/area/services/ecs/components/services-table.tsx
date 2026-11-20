import Box from '@cloudscape-design/components/box';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useEffect, useRef, useState } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import { readFailureState, ReadFailure } from '../../../components/failure-states';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import { NONE, revisionHref, serviceHref, statusText } from '../format';
import type { Service } from '../service-api';
import { countText } from '../service-format';
import { useServiceListing } from '../service-queries';
import { definitionText } from '../task-format';

// The services table of S3 (issue 575, R4): a cluster's services, 10 a page of `ListServices` and one
// `DescribeServices` at a time on the API's own tokens. It holds its own listing and follows it while a service shown
// is settling (`follow.ts`); after each read that following made in place it tells its page (`onFollowedRead`), so the
// page reads its summary with it. The first read, a page change and "Refresh" start from nothing shown and are not
// told.

export interface ServicesTableProps {
  connection: AreaConnection;
  cluster: string;
  /** Called after each read of the shown page that following started. */
  onFollowedRead?: () => void;
  /** A change reads the shown page again from nothing shown (the page's "Refresh"). */
  refreshKey?: number;
}

/** A name keeps room for 24 characters (`aws-area.md`, entry 4). */
const NAME_MIN_WIDTH = '28ch';

function counterText(rows: number, openEnd: boolean): string {
  return `(${String(rows)}${openEnd ? '+' : ''})`;
}

export function ServicesTable({ connection, cluster, onFollowedRead, refreshKey }: ServicesTableProps) {
  const handleFollow = useFollow();
  const listing = useServiceListing(connection.engineOrigin, cluster);
  const { items, refresh, goToPage } = listing;

  // A read in place, by following, replaces one answer by another with nothing in between; every other read starts
  // from nothing shown.
  const seen = useRef<Service[] | undefined>(undefined);
  const told = useRef(onFollowedRead);
  useEffect(() => {
    told.current = onFollowedRead;
  }, [onFollowedRead]);
  useEffect(() => {
    if (seen.current !== undefined && items !== undefined && items !== seen.current) {
      told.current?.();
    }
    seen.current = items;
  }, [items]);

  const [seenRefresh, setSeenRefresh] = useState(refreshKey);
  if (refreshKey !== seenRefresh) {
    setSeenRefresh(refreshKey);
    refresh();
  }

  const fixed = (value: string) => <ValueText kind="fixed" value={value} />;
  const columns: TableProps.ColumnDefinition<Service>[] = [
    {
      id: 'name',
      header: 'Name',
      isRowHeader: true,
      minWidth: NAME_MIN_WIDTH,
      cell: (service) => (
        <Link href={serviceHref(cluster, service.name)} onFollow={handleFollow}>
          <ValueText kind="name" value={service.name} />
        </Link>
      ),
    },
    { id: 'status', header: 'Status', cell: (service) => fixed(statusText(service.status)) },
    { id: 'desired', header: 'Desired', cell: (service) => fixed(countText(service.desired)) },
    { id: 'running', header: 'Running', cell: (service) => fixed(countText(service.running)) },
    { id: 'pending', header: 'Pending', cell: (service) => fixed(countText(service.pending)) },
    {
      id: 'definition',
      header: 'Task definition',
      cell: (service) =>
        service.definition === undefined ? (
          <ValueText kind="address" value={service.definitionArn} none={NONE} />
        ) : (
          <Link href={revisionHref(service.definition.family, service.definition.revision)} onFollow={handleFollow}>
            <ValueText kind="name" value={definitionText(service.definition)} />
          </Link>
        ),
    },
    {
      id: 'launch-type',
      header: 'Launch type',
      cell: (service) => <ValueText kind="fixed" value={service.launchType} none={NONE} />,
    },
  ];

  let empty = null;
  if (listing.failure !== undefined) {
    empty = <ReadFailure state={readFailureState(listing.failure, connection, 'service list')} onRetry={refresh} />;
  } else if (items !== undefined && items.length === 0) {
    empty = listing.pastEnd ? (
      <Box textAlign="center" color="inherit">
        <Box variant="strong" color="inherit">
          No more services
        </Box>
      </Box>
    ) : (
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            No services
          </Box>
          <Box variant="p" color="inherit">
            A service made with the AWS CLI or an IaC tool is listed here.
          </Box>
        </SpaceBetween>
      </Box>
    );
  }

  return (
    <Table<Service>
      variant="container"
      items={items ?? []}
      trackBy="name"
      columnDefinitions={columns}
      wrapLines
      loading={listing.failure === undefined && items === undefined}
      loadingText="Loading services"
      empty={empty}
      header={
        <Header variant="h2" counter={items === undefined ? undefined : counterText(items.length, listing.openEnd)}>
          Services
        </Header>
      }
      pagination={
        <Pagination
          currentPageIndex={listing.currentPage}
          pagesCount={listing.pagesCount}
          openEnd={listing.openEnd}
          disabled={items === undefined}
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
  );
}
