import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import CopyToClipboard from '@cloudscape-design/components/copy-to-clipboard';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import Link from '@cloudscape-design/components/link';
import RadioGroup from '@cloudscape-design/components/radio-group';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { CopyValue } from '../../../components/copy-value';
import { DiscardDialog } from '../../../components/discard-dialog';
import type { AreaConnection } from '../../../components/emulator-line';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { NO_SUCH_BUCKET, type NotificationConfiguration, type NoSuchBucket } from '../api';
import { connectionStatus, pageFailure } from '../components/bucket-read';
import { BucketNotFound, BucketReadFailure } from '../components/bucket-read-state';
import { NotificationChangeStatus } from '../components/notification-change-status';
import { NotificationLoadUnavailable } from '../components/notification-read-state';
import { bucketPropertiesPath, eventNotificationId, notificationDestinationPath } from '../format';
import {
  ALL_CREATIONS,
  editableNotification,
  KEEP_EVENTS,
  notificationDraft,
  notificationIdCounts,
  notificationRules,
  OBJECT_PUT,
  type EditableNotification,
  type NotificationDraft,
  type NotificationChange,
} from '../notifications';
import { useBucketProperty } from '../queries';
import { useNotificationChange, type NotificationChangeControl } from '../use-notification-change';

export const CREATE_TITLE = 'Create event notification';
export const EDIT_TITLE = 'Edit event notification';

const DESTINATIONS = [
  { value: 'SQS queue', label: 'SQS queue' },
  { value: 'Lambda function', label: 'Lambda function' },
];
const EVENTS = [
  { value: ALL_CREATIONS, label: 'All object creation events' },
  { value: OBJECT_PUT, label: 'Object PUTs', description: 'Uploads made with one PUT request.' },
];

type NotificationSave = Exclude<NotificationChange, { kind: 'delete' }>;

export function NotificationPage({ connection, params }: ScreenPageProps) {
  const bucket = params.name ?? '';
  const editing = params.id !== undefined;
  const properties = bucketPropertiesPath(bucket);
  const navigate = useNavigate();
  const follow = useFollow();
  const flash = usePageFlash();
  useShowsResources('buckets');
  const [generation, setGeneration] = useState(0);
  const [loadRetryGeneration, setLoadRetryGeneration] = useState<number>();
  const [submitted, setSubmitted] = useState<{ generation: number; save: NotificationSave }>();
  const read = useBucketProperty(connection.engineOrigin, bucket, 'notifications', { generation, enabled: true });
  const [readback, setReadback] = useState<{
    generation: number;
    value: NotificationConfiguration | NoSuchBucket;
  }>();
  const change = useNotificationChange(
    connection.engineOrigin,
    bucket,
    connection.result !== undefined && connection.result.kind !== 'connected',
    () => flash.handOver(properties, [{ type: 'success', content: 'Event notification saved' }]),
    (value) => setReadback({ generation, value }),
  );

  const status = connectionStatus(connection);
  const disconnected = status !== undefined;
  const [wasDisconnected, setWasDisconnected] = useState(false);
  if (wasDisconnected !== disconnected) {
    setWasDisconnected(disconnected);
    if (!disconnected) {
      setGeneration((current) => current + 1);
    }
  }

  const changeKind = change.state.kind;
  const feedbackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (changeKind !== 'idle' && changeKind !== 'unconfirmed') {
      feedbackRef.current?.scrollIntoView?.({ block: 'center' });
    }
  }, [changeKind]);

  const showSubmitted =
    submitted !== undefined &&
    (changeKind === 'unconfirmed' ||
      (change.state.kind === 'pending' && (change.state.checkingAgain || submitted.generation !== generation)));

  function handleSave(save: NotificationSave) {
    setSubmitted({ generation, save });
    change.submit(save);
  }

  const id = eventNotificationId(params.id);
  // A verification read belongs to the editor's read generation at the time it began.
  // A reconnect opens a fresh generation so a delayed answer cannot replace its result.
  const currentReadback = readback?.generation === generation ? readback : undefined;
  const configuration = currentReadback?.value ?? read.value;
  const rules = configuration === undefined || configuration === NO_SUCH_BUCKET ? [] : notificationRules(configuration);
  const counts = notificationIdCounts(rules);
  const target = rules.find((rule) => rule.data.Id === id && editableNotification(rule, counts));
  const eligible = target !== undefined && editableNotification(target, counts) ? target : undefined;
  const editProblem =
    id === undefined
      ? 'The notification address is invalid.'
      : counts.get(id) === undefined
        ? 'The notification was not found.'
        : counts.get(id) !== 1
          ? 'More than one notification has this name.'
          : 'Only queue and function notifications can be edited.';
  const unsupportedRead = read.failure?.kind === 'not-implemented';

  const returnLink = (
    <Link href={properties} onFollow={follow}>
      Return to Properties
    </Link>
  );

  function handleLoadRetry() {
    setLoadRetryGeneration(generation);
    read.again();
  }

  function handleRefresh() {
    change.clear();
    setGeneration((current) => current + 1);
  }

  return (
    <SpaceBetween size="l">
      <Header
        variant="h1"
        description={
          <>
            Bucket <ValueText kind="name" value={bucket} />
          </>
        }
      >
        {editing ? EDIT_TITLE : CREATE_TITLE}
      </Header>
      {changeKind !== 'idle' && (
        <div
          ref={feedbackRef}
          {...(changeKind === 'pending' ? { role: 'status', 'aria-label': 'Notification save progress' } : {})}
        >
          <NotificationChangeStatus
            change={change}
            connection={connection}
            action="Saving"
            showObserved={!disconnected && currentReadback !== undefined}
            {...(submitted === undefined ? {} : { destination: submitted.save.draft.type })}
            onRefresh={handleRefresh}
          />
        </div>
      )}
      {changeKind === 'interrupted' && submitted !== undefined && (
        <NotificationReference save={submitted.save} interrupted />
      )}
      {editing && id === undefined ? (
        <Container>
          <SpaceBetween size="s">
            <Box>{editProblem}</Box>
            {returnLink}
          </SpaceBetween>
        </Container>
      ) : disconnected && !unsupportedRead ? (
        <BucketReadFailure view={{ type: status.type, first: status, recovery: true }} onRetry={handleLoadRetry} />
      ) : currentReadback === undefined && read.failure !== undefined ? (
        <SpaceBetween size="s">
          {unsupportedRead ? (
            <NotificationLoadUnavailable focus={loadRetryGeneration === generation} />
          ) : (
            <BucketReadFailure
              view={pageFailure(read.failure, connection, 'The event notifications could not be read')}
              onRetry={handleLoadRetry}
            />
          )}
          {unsupportedRead && (
            <SpaceBetween size="xs" direction="horizontal">
              <Button onClick={() => void navigate(properties)}>Cancel</Button>
              <Button variant="primary" disabled>
                {editing ? 'Save changes' : CREATE_TITLE}
              </Button>
            </SpaceBetween>
          )}
        </SpaceBetween>
      ) : configuration === NO_SUCH_BUCKET ? (
        <SpaceBetween size="s">
          <BucketNotFound name={bucket} />
          {editing && returnLink}
        </SpaceBetween>
      ) : configuration === undefined ? (
        <Container>
          <StatusIndicator type="loading">Loading event notifications</StatusIndicator>
        </Container>
      ) : editing && eligible === undefined ? (
        <Container>
          <SpaceBetween size="s">
            <Box>{editProblem}</Box>
            {returnLink}
          </SpaceBetween>
        </Container>
      ) : showSubmitted ? (
        <NotificationReference save={submitted.save} exit={returnLink} />
      ) : (
        <NotificationForm
          key={generation}
          configuration={configuration}
          target={eligible}
          change={change}
          connection={connection}
          onLeave={() => void navigate(properties)}
          onSave={handleSave}
        />
      )}
    </SpaceBetween>
  );
}

function NotificationReference({
  save,
  exit,
  interrupted = false,
}: {
  save: NotificationSave;
  exit?: ReactNode;
  interrupted?: boolean;
}) {
  const { draft } = save;
  const events =
    draft.event === KEEP_EVENTS
      ? save.kind === 'edit'
        ? save.target.data.Events?.join(', ')
        : undefined
      : EVENTS.find(({ value }) => value === draft.event)?.label;
  const fields = [
    { label: 'Notification name', value: draft.id, kind: 'name' },
    { label: 'Destination type', value: draft.type, kind: 'fixed' },
    { label: 'Destination ARN', value: draft.arn, kind: 'address' },
    { label: 'Event type', value: events, kind: 'fixed' },
    { label: 'Prefix', value: draft.prefix, kind: 'text' },
    { label: 'Suffix', value: draft.suffix, kind: 'text' },
  ] as const;
  return (
    <Container
      header={
        <Header
          variant="h2"
          actions={
            interrupted ? (
              <CopyToClipboard
                variant="button"
                textToCopy={fields.map(({ label, value }) => `${label}: ${value ?? ''}`).join('\n')}
                copyButtonText="Copy attempt"
                copySuccessText="Unsubmitted attempt copied"
                copyErrorText="Could not copy the unsubmitted attempt"
                popoverRenderWithPortal={false}
              />
            ) : (
              exit
            )
          }
        >
          {interrupted ? 'Unsubmitted attempt' : 'Submitted notification'}
        </Header>
      }
    >
      <KeyValuePairs
        columns={2}
        minColumnWidth={240}
        items={fields.map(({ label, kind, value }) => ({
          label,
          value:
            kind === 'address' ? (
              <CopyValue
                label={interrupted ? 'unsubmitted destination ARN' : 'submitted destination ARN'}
                value={value}
              />
            ) : (
              <ValueText kind={kind} value={value} none="—" />
            ),
        }))}
      />
    </Container>
  );
}

function NotificationForm({
  configuration,
  target,
  change,
  connection,
  onLeave,
  onSave,
}: {
  configuration: NotificationConfiguration;
  target: EditableNotification | undefined;
  change: NotificationChangeControl;
  connection: AreaConnection;
  onLeave: () => void;
  onSave: (save: NotificationSave) => void;
}) {
  const [initial] = useState(() => notificationDraft(target));
  const [draft, setDraft] = useState(initial);
  const [asking, setAsking] = useState(false);
  const [invalidAttempt, setInvalidAttempt] = useState<{ field: 'name' | 'arn' }>();
  const nameRef = useRef<InputProps.Ref>(null);
  const arnRef = useRef<InputProps.Ref>(null);
  useEffect(() => {
    if (invalidAttempt?.field === 'name') nameRef.current?.focus();
    if (invalidAttempt?.field === 'arn') arnRef.current?.focus();
  }, [invalidAttempt]);
  const cancelRef = useRef<ButtonProps.Ref>(null);
  const [kept, setKept] = useState(0);
  useEffect(() => {
    if (kept > 0) cancelRef.current?.focus();
  }, [kept]);
  const editing = target !== undefined;
  const id = draft.id.trim();
  const arn = draft.arn.trim();
  const duplicate = !editing && notificationRules(configuration).some((rule) => rule.data.Id === id);
  const idError =
    id === '' ? 'Enter a notification name.' : duplicate ? 'A notification with this name already exists.' : undefined;
  const arnError =
    arn === ''
      ? 'Enter a destination ARN.'
      : notificationDestinationPath(draft.type, arn) === undefined ||
          (draft.type === 'SQS queue' && arn.endsWith('.fifo'))
        ? draft.type === 'SQS queue'
          ? 'Enter a valid standard SQS queue ARN.'
          : 'Enter a valid Lambda function ARN.'
        : undefined;
  const locked =
    change.locked || change.state.kind === 'changed' || change.state.kind === 'missing' || change.readFailed;

  function set<K extends keyof NotificationDraft>(field: K, value: NotificationDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || connectionStatus(connection) !== undefined || connection.engineOrigin === undefined) return;
    if (idError !== undefined || arnError !== undefined) {
      setInvalidAttempt({ field: idError !== undefined ? 'name' : 'arn' });
      return;
    }
    const savedDraft = { ...draft, id, arn };
    onSave(target === undefined ? { kind: 'create', draft: savedDraft } : { kind: 'edit', target, draft: savedDraft });
  }

  return (
    <form onSubmit={handleSubmit}>
      <Form
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button
              ref={cancelRef}
              formAction="none"
              variant="link"
              disabled={change.pending}
              onClick={() => {
                if (
                  !editing &&
                  Object.keys(initial).some(
                    (field) => initial[field as keyof NotificationDraft] !== draft[field as keyof NotificationDraft],
                  )
                ) {
                  setAsking(true);
                } else {
                  onLeave();
                }
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              formAction="submit"
              disabled={locked || connection.engineOrigin === undefined || connectionStatus(connection) !== undefined}
            >
              {editing ? 'Save changes' : CREATE_TITLE}
            </Button>
          </SpaceBetween>
        }
      >
        <SpaceBetween size="l">
          <Container header={<Header variant="h2">Notification rule</Header>}>
            <SpaceBetween size="l">
              <FormField label="Notification name" errorText={invalidAttempt === undefined ? undefined : idError}>
                <Input
                  ref={nameRef}
                  value={draft.id}
                  onChange={({ detail }) => set('id', detail.value)}
                  readOnly={editing || change.locked}
                />
              </FormField>
              <FormField label="Destination type">
                <RadioGroup
                  value={draft.type}
                  items={DESTINATIONS.map((item) => ({ ...item, disabled: change.locked }))}
                  onChange={({ detail }) => set('type', detail.value === 'SQS queue' ? 'SQS queue' : 'Lambda function')}
                />
              </FormField>
              <FormField
                label="Destination ARN"
                description="Enter the ARN of the queue or function that should receive matching object events."
                errorText={invalidAttempt === undefined ? undefined : arnError}
              >
                <Input
                  ref={arnRef}
                  value={draft.arn}
                  onChange={({ detail }) => set('arn', detail.value)}
                  readOnly={change.locked}
                />
              </FormField>
              {target?.arn !== undefined && target.arn !== '' && (
                <SpaceBetween size="xxs">
                  <Box variant="strong">Saved destination ARN</Box>
                  <CopyValue label="saved destination ARN" value={target.arn} />
                </SpaceBetween>
              )}
              <FormField label="Event type">
                <RadioGroup
                  value={draft.event}
                  items={[
                    ...(initial.event === KEEP_EVENTS
                      ? [
                          {
                            value: KEEP_EVENTS,
                            label: 'Keep existing events',
                            description: (target?.data.Events ?? []).join(', ') || 'No saved events',
                          },
                        ]
                      : []),
                    ...EVENTS,
                  ].map((item) => ({ ...item, disabled: change.locked }))}
                  onChange={({ detail }) =>
                    set(
                      'event',
                      detail.value === OBJECT_PUT
                        ? OBJECT_PUT
                        : detail.value === KEEP_EVENTS
                          ? KEEP_EVENTS
                          : ALL_CREATIONS,
                    )
                  }
                />
              </FormField>
            </SpaceBetween>
          </Container>
          <Container
            header={
              <Header
                variant="h2"
                description="Leave both filters empty to match every key. Prefix incoming/ and suffix .csv match incoming/orders.csv."
              >
                Object key filters
              </Header>
            }
          >
            <SpaceBetween size="l">
              <FormField label="Prefix (optional)">
                <Input
                  value={draft.prefix}
                  onChange={({ detail }) => set('prefix', detail.value)}
                  readOnly={change.locked}
                />
              </FormField>
              <FormField label="Suffix (optional)">
                <Input
                  value={draft.suffix}
                  onChange={({ detail }) => set('suffix', detail.value)}
                  readOnly={change.locked}
                />
              </FormField>
            </SpaceBetween>
          </Container>
        </SpaceBetween>
      </Form>
      {asking && (
        <DiscardDialog
          visible
          onAnswer={(answer) => {
            setAsking(false);
            if (answer === 'discard') onLeave();
            else setKept((count) => count + 1);
          }}
        />
      )}
    </form>
  );
}
