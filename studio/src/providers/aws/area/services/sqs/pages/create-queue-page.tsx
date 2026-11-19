import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import Link from '@cloudscape-design/components/link';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Tiles from '@cloudscape-design/components/tiles';
import Toggle from '@cloudscape-design/components/toggle';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { DiscardDialog, type DiscardAnswer } from '../../../components/discard-dialog';
import { actionFailureItem, readFailureState, type ReadFailureState } from '../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { NO_SUCH_QUEUE, OPERATIONS, type NewQueue, type QueueChoice } from '../api';
import { actionFailureOf } from '../components/page-signal';
import { maxReceives, maxReceivesMessage, queueNameMessage, queuePath, QUEUES_PATH, type QueueKind } from '../format';
import { useCreateQueue, useDeadLetterChoices, useQueueArn } from '../queries';

// SQS's "Create queue", S3 (issue 489, design task 6): a standard or a FIFO queue, a FIFO queue's content-based
// deduplication, and optionally a dead-letter queue of the same type with its maximum receives. Every other setting
// stays the emulator's default. The name is checked by the emulator's own rules before anything is sent; on submit
// `GetQueueUrl` asks whether the name is taken, since the emulator answers a taken name with the same attributes as a
// success, and only then is `CreateQueue` sent. What is typed lives in this page alone.

/** The page's title, its `h1`, its last crumb and its submit button. */
export const CREATE_QUEUE_TITLE = 'Create queue';

const DESCRIPTION = "Creates a queue with the emulator's default settings and, if you choose one, a dead-letter queue.";
const NAME_RULE =
  "1 to 80 characters: letters, numbers, hyphens (-) and underscores (_). A FIFO queue's name ends with .fifo, counted in the 80.";
const MAX_RECEIVES_RULE =
  'From 1 to 1000. A message received this many times without being deleted moves to the dead-letter queue.';
const CHOOSE_DEAD_LETTER = 'Choose a dead-letter queue.';
const CREATING = 'Creating the queue';

const TYPE_ITEMS = [
  { value: 'standard', label: 'Standard', description: 'Its name does not end with .fifo.' },
  {
    value: 'fifo',
    label: 'FIFO',
    description: 'Its name ends with .fifo, and each message is sent with a message group ID.',
  },
];

/** A dead-letter queue chosen in the field, with its ARN once read. */
interface Chosen {
  queue: QueueChoice;
  arn?: string;
}

interface CreateForm {
  name: string;
  kind: QueueKind;
  deduplication: boolean;
  deadLetterOn: boolean;
  deadLetter: Chosen | undefined;
  maxReceives: string;
}

const START: CreateForm = {
  name: '',
  kind: 'standard',
  deduplication: false,
  deadLetterOn: false,
  deadLetter: undefined,
  maxReceives: '10',
};

/** Whether anything differs from what the form showed when it opened (`aws-area.md`, entry 5). */
function differs(form: CreateForm): boolean {
  return (
    form.name !== START.name ||
    form.kind !== START.kind ||
    form.deduplication !== START.deduplication ||
    form.deadLetterOn !== START.deadLetterOn ||
    form.deadLetter !== undefined ||
    form.maxReceives !== START.maxReceives
  );
}

interface Messages {
  name?: string;
  deadLetter?: string;
  maxReceives?: string;
}

function messagesOf(form: CreateForm): Messages {
  const messages: Messages = {};
  const name = queueNameMessage(form.name, form.kind);
  if (name !== undefined) {
    messages.name = name;
  }
  if (form.deadLetterOn) {
    if (form.deadLetter === undefined) {
      messages.deadLetter = CHOOSE_DEAD_LETTER;
    }
    const receives = maxReceivesMessage(form.maxReceives);
    if (receives !== undefined) {
      messages.maxReceives = receives;
    }
  }
  return messages;
}

/** The kind's word in the dead-letter field's empty states. */
function kindWord(kind: QueueKind): string {
  return kind === 'fifo' ? 'FIFO' : 'standard';
}

/** A failed read in the dead-letter field: its first line, then what follows it. */
function FieldFailure({ state }: { state: ReadFailureState }) {
  return (
    <>
      {state.first}
      {state.detail !== undefined && <> {state.detail}</>}
    </>
  );
}

/**
 * `/aws/sqs/queues/create`. "Create queue" checks the fields, then asks `GetQueueUrl` of the name and sends
 * `CreateQueue` only when the emulator holds no queue of it; once created, the new queue's page opens with "Created
 * queue {name}". A failure of either stays on the form with what was entered, and takes the focus.
 */
export function CreateQueuePage({ connection }: ScreenPageProps) {
  useShowsResources('queues');
  const navigate = useNavigate();
  const flash = usePageFlash();
  const handleFollow = useFollow();
  const engineOrigin = connection.engineOrigin;
  const create = useCreateQueue(engineOrigin);
  const readArn = useQueueArn(engineOrigin);

  const [form, setForm] = useState<CreateForm>(START);
  const [tried, setTried] = useState(false);
  const [taken, setTaken] = useState<string>();
  const [failure, setFailure] = useState<FlashItem>();
  const [arnFailure, setArnFailure] = useState<ReactNode>();
  const [pending, setPending] = useState(false);
  const [filter, setFilter] = useState('');

  const choices = useDeadLetterChoices(engineOrigin, form.kind, filter, form.deadLetterOn);

  const nameRef = useRef<InputProps.Ref>(null);
  const deadLetterRef = useRef<SelectProps.Ref>(null);
  const maxReceivesRef = useRef<InputProps.Ref>(null);
  const failureRef = useRef<AlertProps.Ref>(null);

  // A press while an earlier one is in flight sends nothing; the requests stop when the page is left.
  const busy = useRef(false);
  const inFlight = useRef<AbortController | null>(null);
  const arnRead = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      inFlight.current?.abort();
      arnRead.current?.abort();
    },
    [],
  );

  // A failure takes the focus when it is shown, so a screen reader reads it at once (issue 492's pattern).
  useEffect(() => {
    if (failure !== undefined) {
      failureRef.current?.focus();
    }
  }, [failure]);

  const change = useCallback((update: Partial<CreateForm>) => {
    setForm((current) => ({ ...current, ...update }));
  }, []);

  const arnFailureOf = (error: unknown): ReactNode =>
    error === NO_SUCH_QUEUE ? (
      'The queue is no longer in the emulator.'
    ) : (
      <FieldFailure
        state={readFailureState(actionFailureOf(error, OPERATIONS.getQueueAttributes), connection, 'queue')}
      />
    );

  /** The chosen queue's ARN, read once; rejects with `NO_SUCH_QUEUE` or the request's failure. */
  const arnOf = async (queue: QueueChoice, signal: AbortSignal): Promise<string> => {
    const arn = await readArn(queue.url, signal);
    if (arn === NO_SUCH_QUEUE || arn === undefined) {
      throw NO_SUCH_QUEUE;
    }
    return arn;
  };

  const handleChoose = (queue: QueueChoice) => {
    arnRead.current?.abort();
    const controller = new AbortController();
    arnRead.current = controller;
    setArnFailure(undefined);
    change({ deadLetter: { queue } });
    arnOf(queue, controller.signal).then(
      (arn) => {
        if (!controller.signal.aborted) {
          setForm((current) =>
            current.deadLetter?.queue.url === queue.url ? { ...current, deadLetter: { queue, arn } } : current,
          );
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setArnFailure(arnFailureOf(error));
          setForm((current) =>
            current.deadLetter?.queue.url === queue.url ? { ...current, deadLetter: undefined } : current,
          );
        }
      },
    );
  };

  const messages = tried ? messagesOf(form) : {};

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current) {
      return;
    }
    setTried(true);
    setTaken(undefined);
    setFailure(undefined);
    const found = messagesOf(form);
    if (found.name !== undefined) {
      nameRef.current?.focus();
      return;
    }
    if (found.deadLetter !== undefined) {
      deadLetterRef.current?.focus();
      return;
    }
    if (found.maxReceives !== undefined) {
      maxReceivesRef.current?.focus();
      return;
    }
    if (engineOrigin === undefined) {
      setFailure(
        actionFailureItem(
          { kind: 'engine-did-not-answer', operation: OPERATIONS.getQueueUrl },
          CREATE_QUEUE_TITLE,
          undefined,
        ),
      );
      return;
    }
    busy.current = true;
    setPending(true);
    const controller = new AbortController();
    inFlight.current = controller;
    const done = () => {
      inFlight.current = null;
      busy.current = false;
      setPending(false);
    };

    const { name, kind, deduplication, deadLetterOn, deadLetter } = form;
    let deadLetterArn: string | undefined;
    if (deadLetterOn && deadLetter !== undefined) {
      try {
        deadLetterArn = deadLetter.arn ?? (await arnOf(deadLetter.queue, controller.signal));
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        done();
        setArnFailure(arnFailureOf(error));
        change({ deadLetter: undefined });
        deadLetterRef.current?.focus();
        return;
      }
    }
    const queue: NewQueue = { name, kind, contentBasedDeduplication: deduplication };
    const receives = maxReceives(form.maxReceives);
    if (deadLetterArn !== undefined && receives !== undefined) {
      queue.deadLetter = { arn: deadLetterArn, maxReceiveCount: receives };
    }
    try {
      const outcome = await create(queue, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      done();
      if (outcome.outcome === 'taken') {
        setTaken(name);
        nameRef.current?.focus();
        return;
      }
      flash.handOver(queuePath(name), [{ type: 'success', content: `Created queue ${name}` }]);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      done();
      setFailure(actionFailureItem(actionFailureOf(error, OPERATIONS.createQueue), CREATE_QUEUE_TITLE, engineOrigin));
    }
  };

  // "Cancel" leaves at once while nothing differs from the opening state; otherwise it asks (`aws-area.md`, entry 5).
  const [asking, setAsking] = useState(false);
  const cancelRef = useRef<ButtonProps.Ref>(null);
  const [kept, setKept] = useState(0);
  useEffect(() => {
    if (kept > 0) {
      cancelRef.current?.focus();
    }
  }, [kept]);
  const handleCancel = () => {
    if (differs(form)) {
      setAsking(true);
      return;
    }
    void navigate(QUEUES_PATH);
  };
  const handleDiscardAnswer = useCallback(
    (answer: DiscardAnswer) => {
      setAsking(false);
      if (answer === 'discard') {
        void navigate(QUEUES_PATH);
      } else {
        setKept((count) => count + 1);
      }
    },
    [navigate],
  );

  const nameError: ReactNode =
    taken !== undefined && taken === form.name ? (
      <SpaceBetween size="xxxs">
        <span>
          <ValueText kind="text" value="A queue named " />
          <ValueText kind="name" value={taken} />
          <ValueText kind="text" value=" already exists." />
        </span>
        <Link href={queuePath(taken)} onFollow={handleFollow}>
          <ValueText kind="text" value="Open " />
          <ValueText kind="name" value={taken} />
        </Link>
      </SpaceBetween>
    ) : (
      messages.name
    );

  const listFailure =
    choices.failure === undefined ? undefined : readFailureState(choices.failure, connection, 'queue list');
  let statusType: NonNullable<SelectProps['statusType']> = 'finished';
  if (listFailure !== undefined) {
    statusType = 'error';
  } else if (choices.loading) {
    statusType = 'loading';
  } else if (choices.more) {
    statusType = 'pending';
  }
  const options: SelectProps.Option[] = (choices.choices ?? []).map((choice) => ({
    value: choice.url,
    label: choice.name,
  }));
  const chosen = form.deadLetter;
  const deadLetterError = arnFailure ?? messages.deadLetter;

  return (
    <SpaceBetween size="l">
      <Header variant="h1" description={DESCRIPTION}>
        {CREATE_QUEUE_TITLE}
      </Header>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Form
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button ref={cancelRef} variant="link" formAction="none" onClick={handleCancel}>
                Cancel
              </Button>
              <Button variant="primary" loading={pending} loadingText={CREATING}>
                {CREATE_QUEUE_TITLE}
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Details</Header>}>
              <SpaceBetween size="l">
                <FormField label="Name" constraintText={NAME_RULE} errorText={nameError}>
                  <Input
                    ref={nameRef}
                    value={form.name}
                    invalid={nameError !== undefined}
                    autoComplete={false}
                    spellcheck={false}
                    onChange={({ detail }) => {
                      change({ name: detail.value });
                    }}
                  />
                </FormField>
                <FormField label="Type">
                  <Tiles
                    value={form.kind}
                    items={TYPE_ITEMS}
                    onChange={({ detail }) => {
                      const kind = detail.value as QueueKind;
                      if (kind !== form.kind) {
                        // A chosen dead-letter queue is of the other type now: the emulator would refuse it.
                        arnRead.current?.abort();
                        setArnFailure(undefined);
                        change({ kind, deadLetter: undefined });
                      }
                    }}
                  />
                </FormField>
                {form.kind === 'fifo' && (
                  <Checkbox
                    checked={form.deduplication}
                    description="A message sent without a deduplication ID is given one from its body."
                    onChange={({ detail }) => {
                      change({ deduplication: detail.checked });
                    }}
                  >
                    Content-based deduplication
                  </Checkbox>
                )}
              </SpaceBetween>
            </Container>

            <Container header={<Header variant="h2">Dead-letter queue</Header>}>
              <SpaceBetween size="l">
                <Toggle
                  checked={form.deadLetterOn}
                  onChange={({ detail }) => {
                    change({ deadLetterOn: detail.checked });
                  }}
                >
                  Set a dead-letter queue
                </Toggle>
                {form.deadLetterOn && (
                  <>
                    <FormField label="Dead-letter queue" errorText={deadLetterError}>
                      <Select
                        ref={deadLetterRef}
                        selectedOption={
                          chosen === undefined ? null : { value: chosen.queue.url, label: chosen.queue.name }
                        }
                        options={options}
                        placeholder="Choose a queue"
                        filteringType="manual"
                        filteringPlaceholder="Search by name prefix"
                        filteringAriaLabel="Search by name prefix"
                        invalid={deadLetterError !== undefined}
                        onLoadItems={({ detail }) => {
                          if (detail.samePage) {
                            // "Retry" of a failed list asks again from its first page.
                            choices.refresh();
                          } else if (!detail.firstPage) {
                            choices.loadMore();
                          }
                          setFilter(detail.filteringText);
                        }}
                        statusType={statusType}
                        loadingText="Listing queues"
                        errorText={listFailure?.firstText ?? ''}
                        recoveryText="Retry"
                        empty={
                          choices.prefix === ''
                            ? `No ${kindWord(form.kind)} queue in the emulator`
                            : `No ${kindWord(form.kind)} queue name starts with ${choices.prefix}`
                        }
                        onChange={({ detail }) => {
                          const url = detail.selectedOption.value;
                          const queue = (choices.choices ?? []).find((each) => each.url === url);
                          if (queue !== undefined) {
                            handleChoose(queue);
                          }
                        }}
                      />
                    </FormField>
                    <FormField
                      label="Maximum receives"
                      constraintText={MAX_RECEIVES_RULE}
                      errorText={messages.maxReceives}
                    >
                      <Input
                        ref={maxReceivesRef}
                        inputMode="numeric"
                        value={form.maxReceives}
                        invalid={messages.maxReceives !== undefined}
                        onChange={({ detail }) => {
                          change({ maxReceives: detail.value });
                        }}
                      />
                    </FormField>
                  </>
                )}
              </SpaceBetween>
            </Container>

            {failure !== undefined && (
              <Alert ref={failureRef} type={failure.type} header={failure.header}>
                {failure.content}
              </Alert>
            )}
          </SpaceBetween>
        </Form>
      </form>
      {/* Mounted only while it asks, so nothing of it is in the page before "Cancel" is pressed. */}
      {asking && <DiscardDialog visible onAnswer={handleDiscardAnswer} />}
    </SpaceBetween>
  );
}
