import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import Link from '@cloudscape-design/components/link';
import RadioGroup, { type RadioGroupProps } from '@cloudscape-design/components/radio-group';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator, { type StatusIndicatorProps } from '@cloudscape-design/components/status-indicator';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useState, type FormEvent } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem, readFailureState, ReadFailure } from '../../../components/failure-states';
import { creationDateText } from '../../../components/format-date';
import { usePageFlash } from '../../../components/page-flash';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import { NO_SUCH_QUEUE, OPERATIONS, type MoveRequest, type MoveTask, type QueueDetails } from '../api';
import { nameFromArn, NONE, queuePath, wholeNumber, type QueueSettings } from '../format';
import {
  useCancelMoveTask,
  useMoveTasks,
  useQueueArn,
  useQueueChoices,
  useStartMoveTask,
  type QueueChoice,
} from '../queries';
import { actionFailureOf, usePageSignal } from './page-signal';

// S2's tab "Redrive" on a dead-letter queue (issue 481, design task 5): a form that starts a move of the queue's
// messages back to their source queues or to another queue the emulator holds, and the queue's move tasks, read again
// every 2 seconds while one is RUNNING or CANCELLING, each RUNNING one with "Cancel". Every result is the area's
// Flashbar's; the move tasks' failed read is shown in their place.

type Destination = 'source' | 'another';

/**
 * The destinations to choose from. On the dead-letter queue of more than one source the emulator refuses a move back
 * to the sources (probe-5, `UnsupportedOperation`), so that item is disabled; the Destination field says why.
 */
function destinations(sources: number): RadioGroupProps.RadioButtonDefinition[] {
  return [
    { value: 'source', label: 'Back to their source queues', ...(sources > 1 ? { disabled: true } : {}) },
    { value: 'another', label: 'Another queue' },
  ];
}

/** Why a move back to the sources cannot be chosen on the dead-letter queue of `sources` queues. */
function manySourcesReason(name: string, sources: number): string {
  return `${name} is the dead-letter queue of ${String(sources)} queues, so the emulator cannot tell each message's source queue. Choose the queue to move them to.`;
}

/** The chosen destination and, once read, its `QueueArn`. */
interface Chosen {
  queue: QueueChoice;
  /** `undefined` while it is read. */
  arn: string | undefined;
}

/** "Move the messages of {name} back to its source queues" or "… to {destination}". */
function moveSentence(name: string, destination: string | undefined): string {
  return destination === undefined
    ? `Move the messages of ${name} back to its source queues`
    : `Move the messages of ${name} to ${destination}`;
}

/** "{n} message" or "{n} messages". */
function messages(count: number): string {
  return count === 1 ? '1 message' : `${String(count)} messages`;
}

const STATUS_TYPES: Record<string, StatusIndicatorProps.Type> = {
  RUNNING: 'in-progress',
  COMPLETED: 'success',
  CANCELLING: 'stopped',
  CANCELLED: 'stopped',
  FAILED: 'error',
};

function TaskStatus({ task }: { task: MoveTask }) {
  return (
    <StatusIndicator type={STATUS_TYPES[task.status] ?? 'info'}>
      <ValueText kind="text" value={task.status === '' ? NONE : task.status} />
      {task.status === 'FAILED' && task.failureReason !== undefined && (
        <>
          : <ValueText kind="text" value={task.failureReason} />
        </>
      )}
    </StatusIndicator>
  );
}

function count(value: number | undefined): string {
  return value === undefined ? NONE : String(value);
}

export interface RedriveTabProps {
  details: QueueDetails;
  settings: QueueSettings;
  connection: AreaConnection;
  /** Called once the emulator has started a move task: the messages read before may have moved. */
  onMoveStarted: () => void;
}

export function RedriveTab({ details, settings, connection, onMoveStarted }: RedriveTabProps) {
  const engineOrigin = connection.engineOrigin;
  const name = details.name;
  const sourceArn = settings.arn;
  const flash = usePageFlash();
  const handleFollow = useFollow();
  const pageSignal = usePageSignal();
  const tasks = useMoveTasks(engineOrigin, name, sourceArn);
  const readArn = useQueueArn(engineOrigin);
  const start = useStartMoveTask(engineOrigin);
  const cancel = useCancelMoveTask(engineOrigin);

  // On the dead-letter queue of more than one source, "Another queue" is the only destination the emulator takes.
  const manySources = details.sources.length > 1;
  const [picked, setDestination] = useState<Destination>(manySources ? 'another' : 'source');
  const destination: Destination = manySources ? 'another' : picked;
  const [filter, setFilter] = useState('');
  const choices = useQueueChoices(engineOrigin, filter, destination === 'another');
  const [chosen, setChosen] = useState<Chosen>();
  const [perSecond, setPerSecond] = useState('');
  const [tried, setTried] = useState(false);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState<string>();

  const another = destination === 'another';
  const destinationName = another ? chosen?.queue.name : undefined;
  // With no way back to the sources, the sentence waits for the queue to be chosen.
  const sentence =
    manySources && destinationName === undefined
      ? `Move the messages of ${name} to the queue you choose`
      : moveSentence(name, destinationName);
  const sourceNames = new Set(details.sources);
  const rate = perSecond.trim();
  const rateError = rate !== '' && wholeNumber(rate) === undefined ? 'Enter a whole number.' : undefined;
  const queueError = another && chosen === undefined ? 'Choose a queue.' : undefined;

  const fail = (error: unknown, operation: string, what: string, signal: AbortSignal) => {
    if (!signal.aborted) {
      flash.show([actionFailureItem(actionFailureOf(error, operation), what, engineOrigin)]);
    }
  };

  const handleChoose = (queue: QueueChoice) => {
    const signal = pageSignal();
    setChosen({ queue, arn: undefined });
    readArn(queue.url, signal).then(
      (arn) => {
        if (signal.aborted) {
          return;
        }
        if (arn === NO_SUCH_QUEUE || arn === undefined) {
          setChosen(undefined);
          flash.show([
            {
              type: 'error',
              header: arn === NO_SUCH_QUEUE ? `No queue named ${queue.name}` : `No ARN for ${queue.name}`,
              content:
                arn === NO_SUCH_QUEUE
                  ? 'The emulator no longer holds this queue. Choose another one.'
                  : 'The emulator gave no QueueArn for this queue, so no move can be started to it.',
            },
          ]);
          return;
        }
        setChosen((current) => (current?.queue.url === queue.url ? { queue, arn } : current));
      },
      (error: unknown) => {
        fail(error, OPERATIONS.getQueueAttributes, `Reading the ARN of ${queue.name}`, signal);
        if (!signal.aborted) {
          setChosen((current) => (current?.queue.url === queue.url ? undefined : current));
        }
      },
    );
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (starting || sourceArn === undefined) {
      return;
    }
    setTried(true);
    if (rateError !== undefined || queueError !== undefined || (another && chosen?.arn === undefined)) {
      return;
    }
    const request: MoveRequest = { sourceArn };
    if (another && chosen?.arn !== undefined) {
      request.destinationArn = chosen.arn;
    }
    const max = wholeNumber(rate);
    if (max !== undefined) {
      request.maxPerSecond = max;
    }
    const done = sentence;
    const signal = pageSignal();
    setStarting(true);
    start(request, signal).then(
      () => {
        if (!signal.aborted) {
          setStarting(false);
          onMoveStarted();
          flash.show([
            {
              type: 'success',
              header: `Started: ${done.charAt(0).toLowerCase()}${done.slice(1)}`,
              content: undefined,
            },
          ]);
        }
      },
      (error: unknown) => {
        fail(error, OPERATIONS.startMessageMoveTask, 'Starting the move', signal);
        if (!signal.aborted) {
          setStarting(false);
        }
      },
    );
  };

  const handleCancel = (taskHandle: string) => {
    if (cancelling !== undefined) {
      return;
    }
    const signal = pageSignal();
    setCancelling(taskHandle);
    cancel(taskHandle, signal).then(
      (moved) => {
        if (!signal.aborted) {
          setCancelling(undefined);
          flash.show([
            {
              type: 'success',
              content:
                moved === undefined
                  ? `Cancelled the move of ${name}`
                  : `Cancelled the move of ${name}: ${messages(moved)} moved`,
            },
          ]);
        }
      },
      (error: unknown) => {
        fail(error, OPERATIONS.cancelMessageMoveTask, 'Cancelling the move', signal);
        if (!signal.aborted) {
          setCancelling(undefined);
        }
      },
    );
  };

  // A move of the queue's messages to itself is no destination: the queue is left out of the choices.
  const options: SelectProps.Option[] = (choices.value ?? [])
    .filter((queue) => queue.url !== details.url)
    .map((queue) => ({
      value: queue.url,
      label: queue.name,
      ...(manySources && sourceNames.has(queue.name) ? { description: `A source of ${name}` } : {}),
    }));
  let startDisabledReason: string | undefined;
  if (sourceArn === undefined) {
    startDisabledReason = 'The emulator gave no QueueArn for this queue';
  } else if (another && chosen !== undefined && chosen.arn === undefined) {
    startDisabledReason = "Reading the queue's ARN";
  }
  let statusType: 'finished' | 'loading' | 'error' = 'finished';
  if (choices.loading) {
    statusType = 'loading';
  } else if (choices.failure !== undefined) {
    statusType = 'error';
  }

  const columns: TableProps.ColumnDefinition<MoveTask>[] = [
    { id: 'status', header: 'Status', cell: (task) => <TaskStatus task={task} /> },
    {
      id: 'destination',
      header: 'Destination',
      cell: (task) =>
        task.destinationArn === undefined ? (
          'Source queues'
        ) : (
          <Link href={queuePath(nameFromArn(task.destinationArn))} onFollow={handleFollow}>
            <ValueText kind="name" value={nameFromArn(task.destinationArn)} />
          </Link>
        ),
    },
    { id: 'moved', header: 'Moved', cell: (task) => `${count(task.moved)} of ${count(task.toMove)}` },
    { id: 'started', header: 'Started', cell: (task) => creationDateText(task.started) },
    {
      id: 'actions',
      header: 'Actions',
      cell: (task) => {
        const handle = task.taskHandle;
        if (task.status !== 'RUNNING' || handle === undefined) {
          return null;
        }
        return (
          <Button
            variant="inline-link"
            loading={cancelling === handle}
            disabled={cancelling !== undefined}
            onClick={() => {
              handleCancel(handle);
            }}
          >
            Cancel
          </Button>
        );
      },
    },
  ];

  const tasksState =
    tasks.failure === undefined ? undefined : readFailureState(tasks.failure, connection, 'move tasks');

  return (
    <SpaceBetween size="l">
      <form onSubmit={handleSubmit} noValidate>
        <Form
          actions={
            <Button
              formAction="submit"
              variant="primary"
              loading={starting}
              disabled={
                starting || sourceArn === undefined || (another && chosen !== undefined && chosen.arn === undefined)
              }
              disabledReason={startDisabledReason}
            >
              Start
            </Button>
          }
        >
          <Container
            header={
              <Header variant="h2" description={sentence}>
                Move messages
              </Header>
            }
          >
            <SpaceBetween size="l">
              <FormField
                label="Destination"
                {...(manySources ? { description: manySourcesReason(name, details.sources.length) } : {})}
              >
                <RadioGroup
                  value={destination}
                  items={destinations(details.sources.length)}
                  onChange={({ detail }) => {
                    setDestination(detail.value as Destination);
                  }}
                />
              </FormField>
              {another && (
                <FormField
                  label="Queue"
                  {...(manySources
                    ? { constraintText: `All messages of ${name} go to this queue, whatever queue they came from.` }
                    : {})}
                  errorText={tried ? queueError : undefined}
                >
                  <Select
                    selectedOption={chosen === undefined ? null : { value: chosen.queue.url, label: chosen.queue.name }}
                    options={options}
                    placeholder="Choose a queue"
                    filteringType="manual"
                    filteringPlaceholder="Queue name prefix"
                    filteringAriaLabel="Queue name prefix"
                    onLoadItems={({ detail }) => {
                      // "Retry" of a failed listing asks for the same page again.
                      if (detail.samePage) {
                        choices.refresh();
                      }
                      setFilter(detail.filteringText);
                    }}
                    statusType={statusType}
                    loadingText="Listing queues"
                    errorText="The queues could not be listed"
                    recoveryText="Retry"
                    empty={choices.prefix === '' ? 'No queues' : `No queue name starts with “${choices.prefix}”.`}
                    onChange={({ detail }) => {
                      const url = detail.selectedOption.value;
                      const queue = (choices.value ?? []).find((each) => each.url === url);
                      if (queue !== undefined) {
                        handleChoose(queue);
                      }
                    }}
                  />
                </FormField>
              )}
              <FormField
                label="Messages per second - optional"
                description="Leave empty to let the emulator choose the rate."
                errorText={tried ? rateError : undefined}
              >
                <Input
                  value={perSecond}
                  inputMode="numeric"
                  onChange={({ detail }) => {
                    setPerSecond(detail.value);
                  }}
                />
              </FormField>
            </SpaceBetween>
          </Container>
        </Form>
      </form>
      {tasksState === undefined ? (
        <Table
          header={
            <Header
              variant="h2"
              counter={tasks.value === undefined ? undefined : `(${String(tasks.value.length)})`}
              description="The newest first, at most 10. Read again every 2 seconds while one is running."
              actions={
                <Button
                  iconName="refresh"
                  ariaLabel="Refresh move tasks"
                  disabled={tasks.loading}
                  onClick={tasks.refresh}
                />
              }
            >
              Move tasks
            </Header>
          }
          columnDefinitions={columns}
          items={tasks.value ?? []}
          loading={tasks.value === undefined && tasks.loading && sourceArn !== undefined}
          loadingText="Loading move tasks"
          variant="container"
          empty={
            <Box textAlign="center" color="inherit">
              <Box variant="strong" color="inherit">
                No move tasks
              </Box>
              <Box variant="p" color="inherit">
                No move tasks are listed for this queue.
              </Box>
            </Box>
          }
        />
      ) : (
        <Container header={<Header variant="h2">Move tasks</Header>}>
          <ReadFailure state={tasksState} onRetry={tasks.refresh} />
        </Container>
      )}
    </SpaceBetween>
  );
}
