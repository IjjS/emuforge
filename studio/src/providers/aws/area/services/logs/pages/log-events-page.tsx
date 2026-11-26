import type { FilteredLogEvent } from '@aws-sdk/client-cloudwatch-logs';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Container from '@cloudscape-design/components/container';
import DateInput from '@cloudscape-design/components/date-input';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import TimeInput from '@cloudscape-design/components/time-input';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { ChoiceSelect } from '../../../components/choice-select';
import type { AreaConnection } from '../../../components/emulator-line';
import { ReadFailure, readFailureState, useAnnouncer } from '../../../components/failure-states';
import { creationDateText } from '../../../components/format-date';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { useTokenListing } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { logGroupChoices, logStreamChoices } from '../choices';
import { EventMessage } from '../components/event-message';
import { logStreamPath } from '../format';
import { FILTER_LOG_EVENTS, filterLogEvents } from '../search-api';
import { searchRequest, type SearchForm, type SearchRequest, type SearchTime } from '../search-form';

function searchFailureState(failure: RequestFailure, connection: AreaConnection) {
  const state = readFailureState(failure, connection, 'log events');
  if (
    failure.kind === 'other' &&
    failure.code === 'ValidationException' &&
    failure.message === 'This operation is only supported on the Standard log class.'
  ) {
    const first = 'The emulator reads and searches log events only in log groups of the Standard class.';
    return { ...state, first, firstText: first, detail: failure.message };
  }
  return state;
}

function SearchResults({
  connection,
  request,
  submission,
}: {
  connection: AreaConnection;
  request: SearchRequest;
  submission: number;
}) {
  const follow = useFollow();
  const [announcement, announce] = useAnnouncer();
  const listing = useTokenListing({
    key: ['logs', 'search', request, submission],
    endpoint: connection.engineOrigin,
    operation: FILTER_LOG_EVENTS,
    read: (endpoint, token, signal) => filterLogEvents(endpoint, request, token, signal),
  });
  const failure = listing.failure && searchFailureState(listing.failure, connection);
  const failureText = failure?.firstText;
  useEffect(() => {
    announce(failureText ?? '');
  }, [announce, failureText]);

  return (
    <>
      <Table<FilteredLogEvent>
        header={<Header variant="h2">Search results</Header>}
        items={listing.items ?? []}
        wrapLines
        loading={listing.loading}
        loadingText="Loading log events"
        columnDefinitions={[
          {
            id: 'time',
            header: 'Time',
            cell: ({ timestamp }) => (
              <ValueText
                kind="fixed"
                value={creationDateText(timestamp === undefined ? undefined : new Date(timestamp))}
              />
            ),
          },
          {
            id: 'stream',
            header: 'Log stream',
            cell: ({ logStreamName }) =>
              logStreamName === undefined ? (
                '-'
              ) : (
                <Link href={logStreamPath(request.logGroupName, logStreamName)} onFollow={follow}>
                  <ValueText kind="name" value={logStreamName} />
                </Link>
              ),
          },
          { id: 'message', header: 'Message', cell: ({ message }) => <EventMessage message={message} /> },
        ]}
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
            <Box textAlign="center" variant="strong" display="block">
              No log events match
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

const emptyTime = { date: '', time: '' };

function TimeFields({
  edge,
  value,
  onChange,
  error,
}: {
  edge: 'Start' | 'End';
  value: SearchTime;
  onChange: (value: SearchTime) => void;
  error: string | undefined;
}) {
  return (
    <ColumnLayout columns={2}>
      <FormField label={`${edge} date`} constraintText="YYYY-MM-DD">
        <DateInput value={value.date} onChange={({ detail }) => onChange({ ...value, date: detail.value })} />
      </FormField>
      <FormField label={`${edge} time`} constraintText="HH:MM:SS" errorText={error}>
        <TimeInput
          format="hh:mm:ss"
          use24Hour
          value={value.time}
          onChange={({ detail }) => onChange({ ...value, time: detail.value })}
        />
      </FormField>
    </ColumnLayout>
  );
}

function LogEventSearch({
  connection,
  group,
  stream,
}: {
  connection: AreaConnection;
  group: string | undefined;
  stream: string | undefined;
}) {
  const [form, setForm] = useState<SearchForm>({ group, stream, pattern: '', start: emptyTime, end: emptyTime });
  const [submitted, setSubmitted] = useState<{ request: SearchRequest; number: number }>();
  const [error, setError] = useState<Extract<ReturnType<typeof searchRequest>, { error: string }>>();
  const updateForm = (change: Partial<SearchForm>) => {
    setForm((current) => ({ ...current, ...change }));
    setError(undefined);
  };

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = searchRequest(form);
    if ('error' in result) {
      setError(result);
      return;
    }
    setError(undefined);
    setSubmitted((last) => ({ request: result.request, number: (last?.number ?? 0) + 1 }));
  }

  return (
    <SpaceBetween size="l">
      <form noValidate onSubmit={handleSubmit}>
        <Container
          header={<Header variant="h2">Search filters</Header>}
          footer={
            <Button variant="primary" formAction="submit" disabled={form.group === undefined}>
              Search
            </Button>
          }
        >
          <SpaceBetween size="m">
            <ColumnLayout columns={2}>
              <FormField label="Log group" errorText={error?.field === 'group' ? error.error : undefined}>
                <ChoiceSelect
                  connection={connection}
                  source={logGroupChoices(connection.engineOrigin)}
                  things="log groups"
                  placeholder="Choose a log group"
                  value={form.group}
                  onChange={(next) => {
                    if (next !== form.group) updateForm({ group: next, stream: undefined });
                  }}
                />
              </FormField>
              {form.group !== undefined && (
                <FormField label="Log stream">
                  <ChoiceSelect
                    key={form.group}
                    connection={connection}
                    source={logStreamChoices(connection.engineOrigin, form.group)}
                    things="log streams"
                    fixed="All log streams"
                    value={form.stream}
                    onChange={(next) => updateForm({ stream: next })}
                  />
                </FormField>
              )}
            </ColumnLayout>
            <FormField
              label="Filter pattern"
              description={
                'Words must all appear; put a phrase in double quotes; use { $.field = "value" } for JSON events. Upper and lower case are different.'
              }
            >
              <Input value={form.pattern} onChange={({ detail }) => updateForm({ pattern: detail.value })} />
            </FormField>
            <FormField label="Time range" stretch description="Events at the start and at the end time are included.">
              <ColumnLayout columns={2}>
                <TimeFields
                  edge="Start"
                  value={form.start}
                  onChange={(start) => updateForm({ start })}
                  error={error?.field === 'start' ? error.error : undefined}
                />
                <TimeFields
                  edge="End"
                  value={form.end}
                  onChange={(end) => updateForm({ end })}
                  error={error?.field === 'end' ? error.error : undefined}
                />
              </ColumnLayout>
            </FormField>
          </SpaceBetween>
        </Container>
      </form>
      {submitted === undefined && form.group === undefined && <Box>Choose a log group.</Box>}
      {submitted !== undefined && (
        <SearchResults
          key={submitted.number}
          connection={connection}
          request={submitted.request}
          submission={submitted.number}
        />
      )}
    </SpaceBetween>
  );
}

export function LogEventsPage({ connection }: ScreenPageProps) {
  useShowsResources('log events');
  const [query] = useSearchParams();
  const group = query.get('group') || undefined;
  const stream = group === undefined ? undefined : query.get('stream') || undefined;

  return (
    <SpaceBetween size="l">
      <Header variant="h1">Log events</Header>
      <LogEventSearch key={JSON.stringify([group, stream])} connection={connection} group={group} stream={stream} />
    </SpaceBetween>
  );
}
