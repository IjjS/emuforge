import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useState } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import { ReadFailure, readFailureState } from '../../../components/failure-states';
import { creationDateText } from '../../../components/format-date';
import { NameText } from '../../../components/name-text';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { EventMessage } from '../components/event-message';
import { PutEventsForm } from '../components/put-events-form';
import { LINE_BREAK, LOG_GROUPS_PATH, logGroupPath, nameFromSegment, streamNameForDisplay } from '../format';
import { useStreamEvents } from '../use-stream-events';

const STANDARD_CLASS = 'The emulator reads and searches log events only in log groups of the Standard class.';
const STANDARD_REASON = 'This operation is only supported on the Standard log class.';

function initialFailureState(failure: RequestFailure, connection: AreaConnection) {
  const state = readFailureState(failure, connection, 'log events');
  if (failure.kind === 'other' && failure.code === 'ResourceNotFoundException') {
    for (const resource of ['group', 'stream'] as const) {
      if (failure.message === `The specified log ${resource} does not exist.`) {
        const first = `Log ${resource} not found`;
        return { state: { ...state, first, firstText: first, detail: failure.message }, missing: resource };
      }
    }
  }
  if (failure.kind === 'other' && failure.code === 'ValidationException' && failure.message === STANDARD_REASON) {
    return { state: { ...state, first: STANDARD_CLASS, firstText: STANDARD_CLASS, detail: failure.message } };
  }
  return { state };
}

function continuationFailureState(failure: RequestFailure, connection: AreaConnection, direction: 'older' | 'newer') {
  const state = readFailureState(failure, connection, `${direction} log events`);
  if (failure.kind === 'access-denied' || failure.kind === 'not-implemented') return state;
  return {
    ...state,
    detail: (
      <>
        {failure.operation}: {state.detail}
      </>
    ),
  };
}

type StreamEvents = ReturnType<typeof useStreamEvents>;

function Continuation({
  direction,
  connection,
  streamEvents,
}: {
  direction: 'older' | 'newer';
  connection: AreaConnection;
  streamEvents: StreamEvents;
}) {
  const { token, beforeTime, reading, empty, failure } = streamEvents[direction];
  const load = () => streamEvents.load(direction);
  const label = `Load ${direction} events`;
  const failureState = failure && continuationFailureState(failure, connection, direction);
  return (
    <div role="group" aria-label={label}>
      <SpaceBetween size="xs">
        <Button
          onClick={load}
          loading={reading === true}
          disabled={(token === undefined && beforeTime === undefined) || failure !== undefined}
        >
          {label}
        </Button>
        {empty && <div role="status">{`No ${direction} events.`}</div>}
        {failureState !== undefined && <ReadFailure state={failureState} onRetry={load} />}
      </SpaceBetween>
    </div>
  );
}

export function LogStreamPage({ connection, params }: ScreenPageProps) {
  useShowsResources('log events');
  const group = nameFromSegment(params.group ?? '');
  const stream = nameFromSegment(params.stream ?? '');
  const displayName = streamNameForDisplay(stream);
  const streamEvents = useStreamEvents(connection.engineOrigin, group, stream);
  const { events, initialFailure, prepended, load, readFrom } = streamEvents;
  const flash = usePageFlash();
  const handleFollow = useFollow();
  const [showPut, setShowPut] = useState(false);
  const [putUnavailable, setPutUnavailable] = useState(false);
  const failure = initialFailure === undefined ? undefined : initialFailureState(initialFailure, connection);
  const missing = failure?.missing;

  function handlePut(time: number, { stored, rejected }: { stored: number; rejected: number }) {
    const success: FlashItem = {
      type: 'success',
      content: `${String(stored)} log ${stored === 1 ? 'event' : 'events'} put to ${stream}.`,
    };
    const warning: FlashItem = {
      type: 'warning',
      content: `${String(rejected)} log ${rejected === 1 ? 'event was' : 'events were'} not stored: older than 14 days or more than 2 hours ahead.`,
    };
    flash.show(stored === 0 ? [warning] : rejected === 0 ? [success] : [success, warning]);
    setShowPut(false);
    if (stored > 0) readFrom(time);
  }

  let body;
  if (failure !== undefined) {
    body = (
      <SpaceBetween size="s">
        <ReadFailure state={failure.state} onRetry={() => load('initial')} />
        {missing !== undefined && (
          <Box textAlign="center">
            <Link href={missing === 'group' ? LOG_GROUPS_PATH : logGroupPath(group)} onFollow={handleFollow}>
              {missing === 'group' ? 'Back to Log groups' : 'Back to log group'}
            </Link>
          </Box>
        )}
      </SpaceBetween>
    );
  } else if (events === undefined) {
    body = <StatusIndicator type="loading">Loading log events</StatusIndicator>;
  } else {
    body = (
      <SpaceBetween size="l">
        <ColumnLayout columns={2}>
          <Continuation direction="older" connection={connection} streamEvents={streamEvents} />
          <Continuation direction="newer" connection={connection} streamEvents={streamEvents} />
        </ColumnLayout>
        {events.length === 0 ? (
          <Box textAlign="center" variant="strong" display="block">
            No log events
          </Box>
        ) : (
          <div role="log" aria-label="Log events" aria-live="off">
            <SpaceBetween size="s">
              {events.map(({ timestamp, message }, index) => (
                // Subtracting the prepended count keeps the key of a shown event when older events arrive.
                <div key={index - prepended}>
                  <Box variant="small">
                    <ValueText
                      kind="fixed"
                      value={creationDateText(timestamp === undefined ? undefined : new Date(timestamp))}
                    />
                  </Box>
                  <EventMessage message={message} />
                </div>
              ))}
            </SpaceBetween>
          </div>
        )}
      </SpaceBetween>
    );
  }

  return (
    <SpaceBetween size="l">
      <Header
        variant="h1"
        actions={
          <Button
            disabled={missing !== undefined}
            disabledReason={missing === undefined ? undefined : `The log ${missing} must exist to put events.`}
            onClick={() => setShowPut(true)}
          >
            Put log events
          </Button>
        }
      >
        {LINE_BREAK.test(stream) ? (
          <span style={{ whiteSpace: 'pre-wrap' }}>
            <NameText name={stream} display={displayName} />
          </span>
        ) : (
          <NameText name={stream} display={displayName} />
        )}
      </Header>
      <Container header={<Header variant="h2">Log events</Header>}>{body}</Container>
      {showPut && (
        <PutEventsForm
          endpoint={connection.engineOrigin}
          group={group}
          stream={stream}
          unavailable={putUnavailable}
          onUnavailable={() => setPutUnavailable(true)}
          onDismiss={() => setShowPut(false)}
          onPut={handlePut}
        />
      )}
    </SpaceBetween>
  );
}
