import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import { Code, readFailureState, ReadFailure } from '../../../components/failure-states';
import { creationDateText } from '../../../components/format-date';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import { followsTask } from '../follow';
import { getLogLines, LOG_OPERATIONS, type LogLine, type LogStream } from '../logs-api';
import type { Task } from '../task-api';
import { useContainerLogs } from '../task-queries';

// S5's "Logs" (issue 575, R4 and design task 3): one part per container of the task's definition. A container whose
// definition has `awslogs` with a stream prefix shows its stream's lines from the head, each its time and its message
// as text, never HTML or a link. The lines are kept here and appended by forward token, so a later read never
// replaces or reorders what is shown. While the page follows its task each new read of the task reads the logs on;
// the read that answers `STOPPED` reads them on once more, and then they are not read again by themselves.

export interface TaskLogsProps {
  connection: AreaConnection;
  cluster: string;
  /** The task as last read; each new read of it is a new object. */
  task: Task;
}

/** The part of one container with a log: its lines, read on by "Load newer lines" and by `readOn`'s changes. */
function StreamPart({
  endpoint,
  connection,
  container,
  log,
  readOn,
}: {
  endpoint: string | undefined;
  connection: AreaConnection;
  container: string;
  log: LogStream;
  readOn: number;
}) {
  const pageSignal = usePageSignal();
  const [lines, setLines] = useState<LogLine[] | undefined>(undefined);
  const [failure, setFailure] = useState<RequestFailure>();
  const [reading, setReading] = useState(false);
  const token = useRef<string | undefined>(undefined);
  const inFlight = useRef(false);
  const again = useRef(false);

  const read = useCallback(() => {
    if (endpoint === undefined) {
      return;
    }
    if (inFlight.current) {
      again.current = true;
      return;
    }
    const signal = pageSignal();
    inFlight.current = true;
    setReading(true);
    const step = () => {
      getLogLines(endpoint, log, token.current, signal).then(
        (answer) => {
          if (signal.aborted) return;
          if (answer.nextToken !== undefined) {
            token.current = answer.nextToken;
          }
          setFailure(undefined);
          setLines((current) => [...(current ?? []), ...answer.lines]);
          finish();
        },
        (error: unknown) => {
          if (signal.aborted) return;
          setFailure(failureOf(error, LOG_OPERATIONS.getLogEvents));
          finish();
        },
      );
    };
    const finish = () => {
      if (again.current) {
        again.current = false;
        step();
        return;
      }
      inFlight.current = false;
      setReading(false);
    };
    step();
  }, [endpoint, log, pageSignal]);

  // The first read from the head, then one more on each change of `readOn`.
  useEffect(() => {
    read();
  }, [read, readOn]);

  let body;
  if (failure !== undefined) {
    body = <ReadFailure state={readFailureState(failure, connection, 'log')} onRetry={read} />;
  } else if (lines === undefined) {
    body = <StatusIndicator type="loading">Loading log</StatusIndicator>;
  } else if (lines.length === 0) {
    body = (
      <Box textAlign="center" color="inherit">
        <Box variant="strong" color="inherit">
          No log yet
        </Box>
        <Box variant="p" color="inherit">
          This container has no log line.
        </Box>
      </Box>
    );
  } else {
    body = (
      <div role="log" aria-label={`Log of ${container}`}>
        {lines.map((line, index) => (
          // A line has no id of its own; the lines only ever grow at their end, so its place is its identity.
          <Box key={index} variant="code" display="block">
            <ValueText kind="fixed" value={creationDateText(line.time)} />{' '}
            <ValueText kind="text" value={line.message} />
          </Box>
        ))}
      </div>
    );
  }

  return (
    <Container
      header={
        <Header
          variant="h2"
          description={`Log group ${log.group}, stream ${log.stream}`}
          actions={
            <Button onClick={read} loading={reading} disabled={lines === undefined && failure === undefined}>
              Load newer lines
            </Button>
          }
        >
          {`Log of ${container}`}
        </Header>
      }
    >
      {body}
    </Container>
  );
}

function NoLogPart({ container }: { container: string }) {
  return (
    <Container header={<Header variant="h2">{`Log of ${container}`}</Header>}>
      <Box textAlign="center" color="inherit">
        <Box variant="strong" color="inherit">
          No log for this container
        </Box>
        <Box variant="p" color="inherit">
          Its task definition has no <Code>awslogs</Code> log configuration with a stream prefix.
        </Box>
      </Box>
    </Container>
  );
}

export function TaskLogs({ connection, cluster, task }: TaskLogsProps) {
  const containers = useContainerLogs(connection.engineOrigin, cluster, task);

  // Kept from the previous render, as React's own pattern for it: a new read of a task that was followed reads on.
  const [seenTask, setSeenTask] = useState(task);
  const [readOn, setReadOn] = useState(0);
  if (task !== seenTask) {
    setSeenTask(task);
    if (followsTask(seenTask)) {
      setReadOn((current) => current + 1);
    }
  }

  if (containers.failure !== undefined) {
    return (
      <Container header={<Header variant="h2">Logs</Header>}>
        <ReadFailure
          state={readFailureState(containers.failure, connection, 'task definition')}
          onRetry={containers.refresh}
        />
      </Container>
    );
  }
  if (containers.value === undefined) {
    return (
      <Container header={<Header variant="h2">Logs</Header>}>
        {task.definitionArn === undefined ? (
          <Box variant="p">The task names no task definition, so its log cannot be found.</Box>
        ) : (
          <StatusIndicator type="loading">Loading logs</StatusIndicator>
        )}
      </Container>
    );
  }
  return (
    <SpaceBetween size="l">
      {containers.value.map((entry) =>
        entry.log === undefined ? (
          <NoLogPart key={entry.container} container={entry.container} />
        ) : (
          <StreamPart
            key={entry.container}
            endpoint={connection.engineOrigin}
            connection={connection}
            container={entry.container}
            log={entry.log}
            readOn={readOn}
          />
        ),
      )}
    </SpaceBetween>
  );
}
