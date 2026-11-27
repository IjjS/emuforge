import type { StateValue } from '@aws-sdk/client-cloudwatch';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import TextFilter from '@cloudscape-design/components/text-filter';
import { useEffect, useState } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import { readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import { creationDateText } from '../../../components/format-date';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { useTokenListing } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import { alarmConditionText, isEditableAlarm, type Alarm } from '../alarm';
import { DESCRIBE_ALARMS, listAlarms, type AlarmFilters } from '../alarms-api';
import { AlarmName } from '../components/alarm-name';
import { actionsEnabledText, alarmStateText, alarmTypeText } from '../format';
import { alarmPath, CREATE_ALARM_PATH, editAlarmPath } from '../paths';

const ANY_STATE = { value: '', label: 'Any state' };
const STATES = ['OK', 'ALARM', 'INSUFFICIENT_DATA'] as const;
const STATE_OPTIONS = [ANY_STATE, ...STATES.map((value) => ({ value, label: alarmStateText(value) }))];

const STATE_INDICATORS = {
  OK: 'success',
  ALARM: 'error',
  INSUFFICIENT_DATA: 'pending',
} as const;

interface FilterState {
  prefix: string;
  state: StateValue | undefined;
  visit: number;
}

export function AlarmListPage({ connection }: { connection: AreaConnection }) {
  useShowsResources('alarms');
  const handleFollow = useFollow();
  const [announcement, announce] = useAnnouncer();
  const [filterText, setFilterText] = useState('');
  const [filters, setFilters] = useState<FilterState>({ prefix: '', state: undefined, visit: 0 });
  const [selectedName, setSelectedName] = useState<string>();
  const { prefix, state, visit } = filters;
  const requested: AlarmFilters = { prefix, ...(state === undefined ? {} : { state }) };

  const listing = useTokenListing({
    key: ['cloudwatch', 'alarms', prefix, state, visit],
    endpoint: connection.engineOrigin,
    operation: DESCRIBE_ALARMS,
    read: (endpoint, token, signal) => listAlarms(endpoint, requested, token, signal),
  });
  const rows = listing.items ?? [];
  const selected = rows.find((row) => selectedName !== undefined && row.data.AlarmName === selectedName);
  const canEdit = selected !== undefined && selectedName !== undefined && isEditableAlarm(selected);
  const failure = listing.failure && readFailureState(listing.failure, connection, 'alarm list');
  const message = failure?.firstText ?? (listing.pastEnd ? 'No more alarms' : '');

  useEffect(() => {
    announce(message);
  }, [announce, message]);

  const handleRefresh = () => {
    setSelectedName(undefined);
    listing.refresh();
  };

  const columns: TableProps.ColumnDefinition<Alarm>[] = [
    {
      id: 'name',
      header: 'Name',
      isRowHeader: true,
      minWidth: '28ch',
      cell: ({ data }) =>
        data.AlarmName === undefined ? (
          '-'
        ) : (
          <Link href={alarmPath(data.AlarmName)} onFollow={handleFollow}>
            <AlarmName name={data.AlarmName} />
          </Link>
        ),
    },
    {
      id: 'type',
      header: 'Type',
      cell: ({ type }) => <ValueText kind="fixed" value={alarmTypeText(type)} />,
    },
    {
      id: 'state',
      header: 'State',
      cell: ({ data }) => {
        const state = data.StateValue;
        const indicator = state === undefined ? undefined : STATE_INDICATORS[state];
        return indicator === undefined ? (
          <ValueText kind="fixed" value={alarmStateText(state)} />
        ) : (
          <StatusIndicator type={indicator}>{alarmStateText(state)}</StatusIndicator>
        );
      },
    },
    {
      id: 'condition',
      header: 'Condition',
      cell: (alarm) => <ValueText kind="text" value={alarmConditionText(alarm)} />,
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ data }) => <ValueText kind="fixed" value={actionsEnabledText(data.ActionsEnabled)} />,
    },
    {
      id: 'state-changed',
      header: 'State last changed',
      cell: ({ data }) => <ValueText kind="fixed" value={creationDateText(data.StateTransitionedTimestamp)} />,
    },
  ];

  return (
    <>
      <Table
        variant="full-page"
        items={rows}
        trackBy={(row) => row.data.AlarmName ?? row.data.AlarmArn ?? ''}
        selectionType="single"
        selectedItems={selected === undefined ? [] : [selected]}
        onSelectionChange={({ detail }) => setSelectedName(detail.selectedItems[0]?.data.AlarmName)}
        isItemDisabled={({ data }) => listing.loading || data.AlarmName === undefined}
        ariaLabels={{
          selectionGroupLabel: 'Alarm selection',
          itemSelectionLabel: (_, row) => row.data.AlarmName ?? 'Unnamed alarm',
        }}
        columnDefinitions={columns}
        wrapLines
        loading={listing.loading}
        loadingText="Loading alarms"
        header={
          <Header
            variant="awsui-h1-sticky"
            {...(listing.items === undefined ? {} : { counter: `(${String(rows.length)})` })}
            actions={
              <SpaceBetween size="xs" direction="horizontal">
                <Button ariaLabel="Refresh" iconName="refresh" loading={listing.loading} onClick={handleRefresh} />
                {canEdit ? (
                  <Button href={editAlarmPath(selectedName)} onFollow={handleFollow}>
                    Edit
                  </Button>
                ) : (
                  <Button
                    disabled
                    disabledReason={selected === undefined ? 'Select an alarm.' : 'Studio cannot edit this alarm yet'}
                  >
                    Edit
                  </Button>
                )}
                <Button variant="primary" href={CREATE_ALARM_PATH} onFollow={handleFollow}>
                  Create alarm
                </Button>
              </SpaceBetween>
            }
          >
            Alarms
          </Header>
        }
        filter={
          <ColumnLayout columns={2}>
            <FormField
              label="Find alarms by the start of the name"
              description="Finds alarms whose name begins with the text. Upper and lower case are different."
            >
              <TextFilter
                filteringText={filterText}
                filteringClearAriaLabel="Clear the name filter"
                onChange={({ detail }) => setFilterText(detail.filteringText)}
                onDelayedChange={({ detail }) => {
                  if (detail.filteringText !== prefix) {
                    setSelectedName(undefined);
                    setFilters((current) => ({ ...current, prefix: detail.filteringText, visit: current.visit + 1 }));
                  }
                }}
              />
            </FormField>
            <FormField label="State">
              <Select
                options={STATE_OPTIONS}
                selectedOption={STATE_OPTIONS.find((option) => option.value === (state ?? '')) ?? ANY_STATE}
                onChange={({ detail }) => {
                  const next = STATES.find((value) => value === detail.selectedOption.value);
                  if (next !== state) {
                    setSelectedName(undefined);
                    setFilters((current) => ({ ...current, state: next, visit: current.visit + 1 }));
                  }
                }}
              />
            </FormField>
          </ColumnLayout>
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
          failure ? (
            <ReadFailure state={failure} onRetry={handleRefresh} />
          ) : (
            <Box textAlign="center" color="inherit">
              <Box variant="strong" color="inherit">
                {listing.pastEnd
                  ? 'No more alarms'
                  : prefix !== '' || state !== undefined
                    ? 'No alarms match'
                    : 'No alarms'}
              </Box>
            </Box>
          )
        }
      />
      {announcement}
    </>
  );
}
