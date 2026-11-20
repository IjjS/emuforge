import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table from '@cloudscape-design/components/table';
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';

import { requestFailure, type RequestFailure } from '../../../../../../lib/aws/request';
import { creationDateText } from '../../../components/format-date';
import { ValueText } from '../../../components/value-text';
import { FILTER_LOG_EVENTS, GET_METRIC_STATISTICS } from '../monitor-api';
import { useMonitorReadings } from '../monitor-queries';
import { actionFailureItem } from './failure-states';

interface MonitorTabProps {
  endpoint: string;
  name: string;
  logGroup?: string | undefined;
  onRefreshSettled?: ((message: string) => void) | undefined;
}

type Readings = ReturnType<typeof useMonitorReadings>;

function MonitoringFailure({ failure, endpoint }: { failure: RequestFailure; endpoint: string }) {
  const item = actionFailureItem(failure, failure.operation, endpoint);
  const connectionFailure = failure.kind === 'emulator-did-not-answer' || failure.kind === 'engine-did-not-answer';
  return (
    <SpaceBetween size="xxs">
      <StatusIndicator type={failure.kind === 'not-implemented' ? 'info' : 'error'}>{item.header}</StatusIndicator>
      {connectionFailure && <Box variant="p">{failure.operation} could not be completed.</Box>}
      {item.content && <Box variant="p">{item.content}</Box>}
    </SpaceBetween>
  );
}

function MetricValue({ query, endpoint }: { query: Readings['invocations']; endpoint: string }) {
  if (query.isError) {
    return <MonitoringFailure failure={requestFailure(GET_METRIC_STATISTICS, query.error)} endpoint={endpoint} />;
  }
  if (query.isPending) {
    return <StatusIndicator type="loading">Loading</StatusIndicator>;
  }
  return <Box variant="strong">{query.data ?? 'No data'}</Box>;
}

function LogState({ children }: { children: ReactNode }) {
  return (
    <Container header={<Header variant="h2">Log events</Header>}>
      <Box textAlign="center">{children}</Box>
    </Container>
  );
}

function MonitorTime({ date, showMilliseconds = false }: { date: Date; showMilliseconds?: boolean }) {
  const text = creationDateText(date);
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
  return (
    <time dateTime={date.toISOString()}>
      <ValueText kind="fixed" value={showMilliseconds ? text.replace(' (UTC', `.${milliseconds} (UTC`) : text} />
    </time>
  );
}

function EventTime({ timestamp }: { timestamp: number | undefined }) {
  const date = timestamp === undefined ? undefined : new Date(timestamp);
  return date === undefined || Number.isNaN(date.getTime()) ? (
    creationDateText(undefined)
  ) : (
    <MonitorTime date={date} showMilliseconds />
  );
}

function LogContinuation({
  logs,
  failure,
  endpoint,
}: {
  logs: Readings['logs'];
  failure: RequestFailure | undefined;
  endpoint: string;
}) {
  const terminal = !logs.hasNextPage;
  const controls = useRef<HTMLDivElement>(null);
  const completion = useRef<HTMLDivElement>(null);
  const actionHadFocus = useRef(false);

  useLayoutEffect(() => {
    // Only reclaim focus lost when the continuation control was removed.
    if (terminal && actionHadFocus.current && document.activeElement === document.body) {
      completion.current?.focus({ preventScroll: true });
    }
  }, [terminal]);

  return (
    <div ref={controls}>
      <SpaceBetween size="s">
        {failure !== undefined && <MonitoringFailure failure={failure} endpoint={endpoint} />}
        {!terminal && (
          <Button
            loading={logs.isFetchingNextPage}
            loadingText="Loading more log events"
            disabled={failure?.kind === 'not-implemented'}
            onClick={() => {
              actionHadFocus.current = controls.current?.contains(document.activeElement) ?? false;
              void logs.fetchNextPage({ cancelRefetch: false });
            }}
          >
            {failure === undefined || failure.kind === 'not-implemented' ? 'Load more events' : 'Retry loading events'}
          </Button>
        )}
      </SpaceBetween>
      <div ref={completion} tabIndex={terminal ? -1 : undefined} role="status" aria-live="polite">
        {terminal ? 'No more log events' : null}
      </div>
    </div>
  );
}

function LogEvents({ logs, customGroup, endpoint }: Pick<Readings, 'logs' | 'customGroup'> & { endpoint: string }) {
  if (customGroup) {
    return <LogState>This function uses a custom log group.</LogState>;
  }
  const failure = logs.isError ? requestFailure(FILTER_LOG_EVENTS, logs.error) : undefined;
  if (logs.data === undefined) {
    if (failure === undefined) {
      return (
        <LogState>
          <StatusIndicator type="loading">Loading log events</StatusIndicator>
        </LogState>
      );
    }
    return (
      <LogState>
        <MonitoringFailure failure={failure} endpoint={endpoint} />
      </LogState>
    );
  }
  if (logs.data.pages[0]?.kind === 'missing-group') {
    return (
      <LogState>
        <SpaceBetween size="xxs">
          <Box variant="strong">No log group</Box>
          <Box variant="p">Invoke the function and check that its execution role can write to CloudWatch Logs.</Box>
        </SpaceBetween>
      </LogState>
    );
  }

  const events = logs.data.pages.flatMap((page) => (page.kind === 'events' ? page.events : []));
  const footer =
    logs.hasNextPage || logs.data.pages.length > 1 ? (
      <LogContinuation logs={logs} failure={failure} endpoint={endpoint} />
    ) : undefined;

  return (
    <Table
      header={<Header variant="h2">Log events</Header>}
      ariaLabels={{ tableLabel: 'Log events' }}
      items={events}
      wrapLines
      columnDefinitions={[
        {
          id: 'timestamp',
          header: 'Timestamp',
          width: '30%',
          cell: ({ timestamp }) => <EventTime timestamp={timestamp} />,
        },
        {
          id: 'message',
          header: 'Message',
          cell: ({ message }) => (
            // Let the cell size to the table, then let the area's ValueText wrap within it.
            <div style={{ contain: 'inline-size', whiteSpace: 'pre-wrap' }}>
              <ValueText kind="text" value={message} />
            </div>
          ),
        },
      ]}
      empty={
        <Box textAlign="center" variant="strong">
          {logs.hasNextPage ? 'No log events in the pages loaded' : 'No log events'}
        </Box>
      }
      footer={footer}
    />
  );
}

function MonitorReadings({ endpoint, name, logGroup, onRefreshSettled }: MonitorTabProps) {
  const readings = useMonitorReadings(endpoint, name, logGroup);
  const { invocations, errors, logs, customGroup } = readings;
  const firstLogPagePending = !customGroup && logs.data === undefined && !logs.isError;
  const firstLogPageFailed = !customGroup && logs.data === undefined && logs.isError;

  useEffect(() => {
    if (onRefreshSettled === undefined || invocations.isPending || errors.isPending || firstLogPagePending) {
      return;
    }
    const failed = [
      ...(invocations.isError ? ['Invocations'] : []),
      ...(errors.isError ? ['Errors'] : []),
      ...(firstLogPageFailed ? ['Log events'] : []),
    ];
    if (failed.length === 0) {
      onRefreshSettled('Monitor refreshed');
      return;
    }
    const result = failed.length === (customGroup ? 2 : 3) ? 'Monitor refresh failed' : 'Monitor partially refreshed';
    onRefreshSettled(`${result}. Could not read ${new Intl.ListFormat('en').format(failed)}.`);
  }, [
    onRefreshSettled,
    invocations.isPending,
    invocations.isError,
    errors.isPending,
    errors.isError,
    firstLogPagePending,
    firstLogPageFailed,
    customGroup,
  ]);
  return (
    <SpaceBetween size="l">
      <Container
        header={
          <Header
            variant="h2"
            description={
              <>
                Window ended <MonitorTime date={readings.windowEnd} />
              </>
            }
          >
            Last hour
          </Header>
        }
      >
        <KeyValuePairs
          columns={2}
          items={[
            { label: 'Invocations', value: <MetricValue query={readings.invocations} endpoint={endpoint} /> },
            { label: 'Errors', value: <MetricValue query={readings.errors} endpoint={endpoint} /> },
          ]}
        />
      </Container>
      <LogEvents logs={readings.logs} customGroup={readings.customGroup} endpoint={endpoint} />
    </SpaceBetween>
  );
}

export function MonitorTab(props: MonitorTabProps) {
  // A new function or engine starts a new window and first page.
  return <MonitorReadings key={JSON.stringify([props.endpoint, props.name, props.logGroup])} {...props} />;
}
