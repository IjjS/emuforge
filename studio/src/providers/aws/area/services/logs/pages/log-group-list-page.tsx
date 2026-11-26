import type { LogGroup } from '@aws-sdk/client-cloudwatch-logs';
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

import type { AreaConnection } from '../../../components/emulator-line';
import { readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import { creationDateText } from '../../../components/format-date';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import { DeleteLogGroupDialog } from '../components/delete-log-group-dialog';
import {
  CREATE_LOG_GROUP_PATH,
  CREATE_LOG_GROUP_TITLE,
  deletionProtectionText,
  LOG_GROUPS_TITLE,
  logGroupClassText,
  logGroupPath,
  retentionText,
} from '../format';
import { useGroupListing } from '../use-group-listing';

const NO_MORE = 'No more log groups.';
const LOADING = 'Loading log groups';

export function LogGroupListPage({ connection }: { connection: AreaConnection }) {
  useShowsResources('log groups');
  const handleFollow = useFollow();
  const [announcement, announce] = useAnnouncer();
  const flash = usePageFlash();
  const [filterText, setFilterText] = useState('');
  const [pattern, setPattern] = useState('');
  const [selectedName, setSelectedName] = useState<string>();
  const [deleteTarget, setDeleteTarget] = useState<{ name: string; protectedFromDeletion: boolean }>();
  const [deleteUnavailable, setDeleteUnavailable] = useState(false);

  const listing = useGroupListing(connection.engineOrigin, pattern);
  const refreshAfterDelete = useRef(listing.refresh);
  useLayoutEffect(() => {
    // A delayed filter change can start a new listing while the dialog is open.
    refreshAfterDelete.current = listing.refresh;
  }, [listing.refresh]);
  const rows = listing.items ?? [];
  const selected = rows.find((row) => row.logGroupName !== undefined && row.logGroupName === selectedName);
  const failure = listing.failure && readFailureState(listing.failure, connection, 'log group list');
  const message = failure?.firstText ?? (listing.endedHere ? NO_MORE : undefined);

  useEffect(() => {
    announce(message ?? '');
  }, [announce, message]);

  const handleRefresh = () => {
    setSelectedName(undefined);
    listing.refresh();
  };

  const handleFilter = (next: string) => {
    setSelectedName(undefined);
    setPattern(next);
  };

  const handleOpenDelete = () => {
    if (selected?.logGroupName !== undefined) {
      setDeleteTarget({
        name: selected.logGroupName,
        protectedFromDeletion: selected.deletionProtectionEnabled === true,
      });
    }
  };

  const handleDeleted = (name: string) => {
    flash.show([
      {
        type: 'success',
        content: (
          <>
            Log group <ValueText kind="name" value={name} /> deleted.
          </>
        ),
      },
    ]);
    setDeleteTarget(undefined);
    setSelectedName(undefined);
    refreshAfterDelete.current();
  };

  const columns: TableProps.ColumnDefinition<LogGroup>[] = [
    {
      id: 'name',
      header: 'Log group name',
      isRowHeader: true,
      minWidth: '28ch',
      cell: ({ logGroupName }) =>
        logGroupName === undefined ? (
          '-'
        ) : (
          <Link href={logGroupPath(logGroupName)} onFollow={handleFollow}>
            <ValueText kind="name" value={logGroupName} />
          </Link>
        ),
    },
    {
      id: 'retention',
      header: 'Retention',
      cell: ({ retentionInDays }) => <ValueText kind="fixed" value={retentionText(retentionInDays)} />,
    },
    {
      id: 'class',
      header: 'Class',
      cell: ({ logGroupClass }) => <ValueText kind="fixed" value={logGroupClassText(logGroupClass)} />,
    },
    {
      id: 'protection',
      header: 'Deletion protection',
      cell: ({ deletionProtectionEnabled }) => (
        <ValueText kind="fixed" value={deletionProtectionText(deletionProtectionEnabled)} />
      ),
    },
    {
      id: 'creation-time',
      header: 'Creation time',
      cell: ({ creationTime }) => (
        <ValueText
          kind="fixed"
          value={creationDateText(creationTime === undefined ? undefined : new Date(creationTime))}
        />
      ),
    },
  ];

  return (
    <>
      <Table
        variant="full-page"
        items={rows}
        trackBy="logGroupName"
        selectionType="single"
        selectedItems={selected === undefined ? [] : [selected]}
        onSelectionChange={({ detail }) => setSelectedName(detail.selectedItems[0]?.logGroupName)}
        isItemDisabled={({ logGroupName }) => listing.loading || logGroupName === undefined}
        ariaLabels={{
          selectionGroupLabel: 'Log group selection',
          itemSelectionLabel: (_, row) => row.logGroupName ?? 'Unnamed log group',
        }}
        columnDefinitions={columns}
        wrapLines
        loading={listing.loading}
        loadingText={LOADING}
        {...(rows.length > 0 && { skeleton: { totalRows: rows.length + 1 } })}
        header={
          <Header
            variant="awsui-h1-sticky"
            actions={
              <SpaceBetween size="xs" direction="horizontal">
                <Button ariaLabel="Refresh" iconName="refresh" loading={listing.loading} onClick={handleRefresh} />
                <Button
                  disabled={selected === undefined || listing.loading}
                  disabledReason="Select a log group."
                  onClick={handleOpenDelete}
                >
                  Delete
                </Button>
                <Button variant="primary" href={CREATE_LOG_GROUP_PATH} onFollow={handleFollow}>
                  {CREATE_LOG_GROUP_TITLE}
                </Button>
              </SpaceBetween>
            }
          >
            {LOG_GROUPS_TITLE}
          </Header>
        }
        filter={
          <FormField
            label="Filter by name"
            description="Finds log groups whose name contains the text. Upper and lower case are different."
          >
            <TextFilter
              filteringText={filterText}
              filteringClearAriaLabel="Clear the name filter"
              onChange={({ detail }) => setFilterText(detail.filteringText)}
              onDelayedChange={({ detail }) => {
                if (detail.filteringText !== pattern) handleFilter(detail.filteringText);
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
            <ReadFailure state={failure} onRetry={handleRefresh} />
          ) : listing.currentPage === 1 ? (
            <Box textAlign="center" color="inherit">
              <Box variant="strong" color="inherit">
                {pattern === '' ? 'No log groups' : 'No log groups match'}
              </Box>
            </Box>
          ) : null
        }
      />
      {listing.endedHere && <Box margin={{ top: 's' }}>{NO_MORE}</Box>}
      {announcement}
      {deleteTarget !== undefined && connection.engineOrigin !== undefined && (
        <DeleteLogGroupDialog
          endpoint={connection.engineOrigin}
          name={deleteTarget.name}
          protectedFromDeletion={deleteTarget.protectedFromDeletion}
          unavailable={deleteUnavailable}
          onUnavailable={() => setDeleteUnavailable(true)}
          onDeleted={handleDeleted}
          onDismiss={() => setDeleteTarget(undefined)}
        />
      )}
    </>
  );
}
