import type { EventBus } from '@aws-sdk/client-eventbridge';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import TextFilter from '@cloudscape-design/components/text-filter';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import { creationDateText } from '../../../components/format-date';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { useTokenListing } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { BUS_OPERATIONS, listEventBuses } from '../bus-api';
import { BUS_DELETE_UNAVAILABLE, DEFAULT_BUS_DELETE_REASON } from '../bus-change-api';
import { DeleteEventBusDialog } from '../components/delete-event-bus-dialog';
import { busPath, CREATE_EVENT_BUS_PATH, CREATE_EVENT_BUS_TITLE, EVENT_BUSES_TITLE } from '../format';

const NO_MORE = 'No more event buses.';

export function EventBusListPage({ connection }: Pick<ScreenPageProps, 'connection'>) {
  useShowsResources('event buses');
  const handleFollow = useFollow();
  const flash = usePageFlash();
  const { engineOrigin } = connection;
  const [announcement, announce] = useAnnouncer();
  const [filterText, setFilterText] = useState('');
  const [prefix, setPrefix] = useState('');
  const [selectedName, setSelectedName] = useState<string>();
  const [deleteTarget, setDeleteTarget] = useState<string>();
  const [deleteUnavailable, setDeleteUnavailable] = useState(false);

  const listing = useTokenListing({
    key: ['events', 'buses', prefix],
    endpoint: engineOrigin,
    operation: BUS_OPERATIONS.listEventBuses,
    read: (endpoint, token, signal) => listEventBuses(endpoint, prefix, token, signal),
  });
  const refreshAfterDelete = useRef(listing.refresh);
  useLayoutEffect(() => {
    refreshAfterDelete.current = listing.refresh;
  }, [listing.refresh]);

  const rows = listing.items ?? [];
  const selected = rows.find(({ Name }) => Name !== undefined && Name === selectedName);
  const deleteReason =
    selected?.Name === 'default' ? DEFAULT_BUS_DELETE_REASON : deleteUnavailable ? BUS_DELETE_UNAVAILABLE : undefined;
  const canDelete =
    selected?.Name !== undefined &&
    engineOrigin !== undefined &&
    deleteReason === undefined &&
    deleteTarget === undefined &&
    !listing.loading;
  const failure = listing.failure && readFailureState(listing.failure, connection, 'event bus list');
  const message = failure?.firstText ?? (listing.pastEnd ? NO_MORE : undefined);

  useEffect(() => {
    announce(message ?? '');
  }, [announce, message]);

  const columns: TableProps.ColumnDefinition<EventBus>[] = [
    {
      id: 'name',
      header: 'Name',
      isRowHeader: true,
      minWidth: '28ch',
      cell: ({ Name }) =>
        Name === undefined ? (
          '-'
        ) : (
          <Link href={busPath(Name)} onFollow={handleFollow}>
            <ValueText kind="name" value={Name} />
          </Link>
        ),
    },
    {
      id: 'description',
      header: 'Description',
      cell: ({ Description }) => <ValueText kind="text" value={Description || '-'} />,
    },
    {
      id: 'creation-time',
      header: 'Creation time',
      cell: ({ CreationTime }) => <ValueText kind="fixed" value={creationDateText(CreationTime)} />,
    },
    {
      id: 'last-change',
      header: 'Last change',
      cell: ({ LastModifiedTime }) => <ValueText kind="fixed" value={creationDateText(LastModifiedTime)} />,
    },
  ];

  return (
    <>
      <Table
        variant="full-page"
        items={rows}
        trackBy="Name"
        selectionType="single"
        selectedItems={selected === undefined ? [] : [selected]}
        onSelectionChange={({ detail }) => setSelectedName(detail.selectedItems[0]?.Name)}
        isItemDisabled={({ Name }) => listing.loading || Name === undefined}
        ariaLabels={{
          selectionGroupLabel: 'Event bus selection',
          itemSelectionLabel: (_, row) => row.Name ?? 'Unnamed event bus',
        }}
        columnDefinitions={columns}
        wrapLines
        loading={listing.loading}
        loadingText="Loading event buses"
        {...(rows.length > 0 && { skeleton: { totalRows: rows.length + 1 } })}
        header={
          <Header
            variant="awsui-h1-sticky"
            actions={
              <SpaceBetween size="xs" direction="horizontal">
                <Button
                  ariaLabel="Refresh"
                  iconName="refresh"
                  loading={listing.loading}
                  onClick={() => {
                    setSelectedName(undefined);
                    listing.refresh();
                  }}
                />
                <Button
                  disabled={!canDelete}
                  disabledReason={deleteReason}
                  onClick={() => {
                    if (canDelete) setDeleteTarget(selected.Name);
                  }}
                >
                  Delete
                </Button>
                <Button variant="primary" href={CREATE_EVENT_BUS_PATH} onFollow={handleFollow}>
                  {CREATE_EVENT_BUS_TITLE}
                </Button>
              </SpaceBetween>
            }
          >
            {EVENT_BUSES_TITLE}
          </Header>
        }
        filter={
          <FormField
            label="Filter by name"
            description="Finds event buses whose name starts with the text. Upper and lower case are different."
          >
            <TextFilter
              filteringText={filterText}
              filteringClearAriaLabel="Clear the name filter"
              onChange={({ detail }) => setFilterText(detail.filteringText)}
              onDelayedChange={({ detail }) => {
                if (detail.filteringText !== prefix) {
                  setSelectedName(undefined);
                  setPrefix(detail.filteringText);
                }
              }}
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
            onChange={({ detail }) => {
              setSelectedName(undefined);
              listing.goToPage(detail.currentPageIndex);
            }}
          />
        }
        empty={
          failure !== undefined ? (
            <ReadFailure state={failure} onRetry={listing.refresh} />
          ) : (
            <Box textAlign="center" variant="strong">
              {listing.pastEnd ? NO_MORE : prefix === '' ? 'No event buses' : 'No event buses match'}
            </Box>
          )
        }
      />
      {engineOrigin !== undefined && deleteTarget !== undefined && (
        <DeleteEventBusDialog
          endpoint={engineOrigin}
          name={deleteTarget}
          onDismiss={() => setDeleteTarget(undefined)}
          onUnavailable={() => setDeleteUnavailable(true)}
          onDeleted={() => {
            setDeleteTarget(undefined);
            setSelectedName(undefined);
            flash.show([
              {
                type: 'success',
                content: (
                  <>
                    Event bus <ValueText kind="name" value={deleteTarget} /> deleted.
                  </>
                ),
              },
            ]);
            refreshAfterDelete.current();
          }}
        />
      )}
      {announcement}
    </>
  );
}
