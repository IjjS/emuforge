import type { Rule } from '@aws-sdk/client-eventbridge';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import TextFilter from '@cloudscape-design/components/text-filter';
import { useEffect, useMemo, useState } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import { readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import { useFollow } from '../../../components/use-follow';
import { useTokenListing } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import { rulePath, ruleStateText, ruleTriggerText } from '../format';
import { listRules, RULE_OPERATIONS } from '../rule-api';

interface RulesTableProps {
  connection: AreaConnection;
  bus: string;
  holdListing?: boolean;
  readsEnabled?: boolean;
}

export function RulesTable({ connection, bus, holdListing = false, readsEnabled = true }: RulesTableProps) {
  const handleFollow = useFollow();
  const [announcement, announce] = useAnnouncer();
  const [filterText, setFilterText] = useState('');
  const [prefix, setPrefix] = useState('');
  const listing = useTokenListing({
    key: ['events', 'rules', bus, prefix],
    endpoint: connection.engineOrigin,
    enabled: readsEnabled,
    operation: RULE_OPERATIONS.listRules,
    read: (endpoint, token, signal) => listRules(endpoint, bus, prefix, token, signal),
  });
  const { items, currentPage, pagesCount, openEnd, pastEnd } = listing;
  const page = useMemo(
    () => ({ items, currentPage, pagesCount, openEnd, pastEnd, prefix }),
    [items, currentPage, pagesCount, openEnd, pastEnd, prefix],
  );
  const [lastShown, setLastShown] = useState<typeof page>();
  if (!holdListing && items !== undefined && page !== lastShown) {
    setLastShown(page);
  }
  const shown = holdListing ? lastShown : page;
  const loading = !holdListing && listing.loading;
  const failure =
    !holdListing && listing.failure ? readFailureState(listing.failure, connection, 'rule list') : undefined;
  const message = failure?.firstText ?? (!holdListing && pastEnd ? 'No more rules.' : '');

  useEffect(() => {
    announce(message);
  }, [announce, message]);

  const columns: TableProps.ColumnDefinition<Rule>[] = [
    {
      id: 'name',
      header: 'Name',
      isRowHeader: true,
      minWidth: '28ch',
      cell: ({ Name }) =>
        Name === undefined ? (
          '-'
        ) : (
          <Link href={rulePath(bus, Name)} onFollow={handleFollow}>
            <ValueText kind="name" value={Name} />
          </Link>
        ),
    },
    {
      id: 'state',
      header: 'State',
      cell: ({ State }) => <ValueText kind="fixed" value={ruleStateText(State)} />,
    },
    {
      id: 'trigger',
      header: 'Trigger',
      cell: ({ EventPattern, ScheduleExpression }) => (
        <ValueText kind="fixed" value={ruleTriggerText(EventPattern, ScheduleExpression)} />
      ),
    },
    {
      id: 'description',
      header: 'Description',
      cell: ({ Description }) => <ValueText kind="text" value={Description} none="-" />,
    },
  ];

  return (
    <>
      <Table
        ariaLabels={{ tableLabel: 'Rules' }}
        items={shown?.items ?? []}
        trackBy="Name"
        columnDefinitions={columns}
        wrapLines
        loading={loading}
        loadingText="Loading rules"
        header={
          <Header
            variant="h2"
            actions={<Button ariaLabel="Refresh" iconName="refresh" loading={loading} onClick={listing.refresh} />}
          >
            Rules
          </Header>
        }
        filter={
          <FormField
            label="Filter by name"
            description="Finds rules whose name starts with the text. Upper and lower case are different."
          >
            <TextFilter
              filteringText={filterText}
              filteringClearAriaLabel="Clear the name filter"
              onChange={({ detail }) => setFilterText(detail.filteringText)}
              onDelayedChange={({ detail }) => setPrefix(detail.filteringText)}
            />
          </FormField>
        }
        pagination={
          <Pagination
            currentPageIndex={shown?.currentPage ?? 1}
            pagesCount={shown?.pagesCount ?? 1}
            openEnd={shown?.openEnd ?? false}
            disabled={loading}
            ariaLabels={{
              nextPageLabel: 'Next page',
              previousPageLabel: 'Previous page',
              pageLabel: (page) => `Page ${String(page)}`,
            }}
            onChange={({ detail }) => listing.goToPage(detail.currentPageIndex)}
          />
        }
        empty={
          failure !== undefined ? (
            <ReadFailure state={failure} onRetry={listing.refresh} />
          ) : shown !== undefined ? (
            <Box textAlign="center" variant="strong">
              {shown.pastEnd ? 'No more rules.' : shown.prefix === '' ? 'No rules' : 'No rules match'}
            </Box>
          ) : undefined
        }
      />
      {announcement}
    </>
  );
}
