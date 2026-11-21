import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import Link from '@cloudscape-design/components/link';
import RadioGroup from '@cloudscape-design/components/radio-group';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { DiscardDialog } from '../../../components/discard-dialog';
import type { AreaConnection } from '../../../components/emulator-line';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { NO_SUCH_BUCKET, type NotificationConfiguration } from '../api';
import { connectionStatus, pageFailure } from '../components/bucket-read';
import { BucketNotFound, BucketReadFailure } from '../components/bucket-read-state';
import { NotificationChangeStatus } from '../components/notification-change-status';
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
  { value: OBJECT_PUT, label: 'Object PUTs' },
];

export function NotificationPage({ connection, params }: ScreenPageProps) {
  const bucket = params.name ?? '';
  const editing = params.id !== undefined;
  const properties = bucketPropertiesPath(bucket);
  const navigate = useNavigate();
  const follow = useFollow();
  const flash = usePageFlash();
  useShowsResources('buckets');
  const [generation, setGeneration] = useState(0);
  const read = useBucketProperty(connection.engineOrigin, bucket, 'notifications', { generation, enabled: true });
  const change = useNotificationChange(connection.engineOrigin, bucket, () => {
    flash.handOver(properties, [{ type: 'success', content: 'Event notification saved' }]);
    void navigate(properties);
  });

  const status = connectionStatus(connection);
  const disconnected = status !== undefined;
  const [wasDisconnected, setWasDisconnected] = useState(false);
  if (wasDisconnected !== disconnected) {
    setWasDisconnected(disconnected);
    if (!disconnected) setGeneration((current) => current + 1);
  }

  const id = eventNotificationId(params.id);
  const configuration = read.value;
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
      {editing && id === undefined ? (
        <Container>
          <SpaceBetween size="s">
            <Box>{editProblem}</Box>
            <Link href={properties} onFollow={follow}>
              Return to Properties
            </Link>
          </SpaceBetween>
        </Container>
      ) : disconnected && !change.locked && !unsupportedRead ? (
        <BucketReadFailure view={{ type: status.type, first: status, recovery: true }} onRetry={read.again} />
      ) : read.failure !== undefined ? (
        <SpaceBetween size="s">
          <BucketReadFailure
            view={pageFailure(read.failure, connection, 'The event notifications could not be read')}
            onRetry={read.again}
          />
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
        <BucketNotFound name={bucket} />
      ) : configuration === undefined ? (
        <Container>
          <StatusIndicator type="loading">Loading event notifications</StatusIndicator>
        </Container>
      ) : editing && eligible === undefined ? (
        <Container>
          <SpaceBetween size="s">
            <Box>{editProblem}</Box>
            <Link href={properties} onFollow={follow}>
              Return to Properties
            </Link>
          </SpaceBetween>
        </Container>
      ) : (
        <NotificationForm
          key={generation}
          configuration={configuration}
          target={eligible}
          change={change}
          connection={connection}
          onLeave={() => void navigate(properties)}
          onRefresh={handleRefresh}
        />
      )}
    </SpaceBetween>
  );
}

function NotificationForm({
  configuration,
  target,
  change,
  connection,
  onLeave,
  onRefresh,
}: {
  configuration: NotificationConfiguration;
  target: EditableNotification | undefined;
  change: NotificationChangeControl;
  connection: AreaConnection;
  onLeave: () => void;
  onRefresh: () => void;
}) {
  const [initial] = useState(() => notificationDraft(target));
  const [draft, setDraft] = useState(initial);
  const [asking, setAsking] = useState(false);
  const [validated, setValidated] = useState(false);
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
    setValidated(true);
    if (idError !== undefined || arnError !== undefined) return;
    const savedDraft = { ...draft, id, arn };
    change.submit(
      target === undefined ? { kind: 'create', draft: savedDraft } : { kind: 'edit', target, draft: savedDraft },
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <Form
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button
              ref={cancelRef}
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
          <NotificationChangeStatus
            change={change}
            connection={connection}
            action="Saving"
            destination={draft.type}
            onRefresh={onRefresh}
          />
          <Container header={<Header variant="h2">Notification rule</Header>}>
            <SpaceBetween size="l">
              <FormField label="Notification name" errorText={validated ? idError : undefined}>
                <Input
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
                errorText={validated ? arnError : undefined}
              >
                <Input value={draft.arn} onChange={({ detail }) => set('arn', detail.value)} readOnly={change.locked} />
              </FormField>
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
              <Header variant="h2" description="Leave both filters empty to match every key.">
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
