import { useQuery } from '@tanstack/react-query';
import FormField from '@cloudscape-design/components/form-field';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Textarea, { type TextareaProps } from '@cloudscape-design/components/textarea';
import { useEffect, useEffectEvent, useImperativeHandle, useRef, type Ref } from 'react';

import { ChoiceSelect } from '../../../components/choice-select';
import type { AreaConnection } from '../../../components/emulator-line';
import { readFailureState, ReadFailure } from '../../../components/failure-states';
import { failureOf, noEndpoint } from '../../../components/use-token-listing';
import {
  chooseTargetKind,
  chooseTargetResource,
  isFifoTarget,
  setTargetQueueArn,
  TARGET_ID_CONSTRAINT,
  type TargetDraft,
  type TargetErrors,
  type TargetField,
  type TargetInputKind,
  type TargetKind,
} from '../target-form';
import { getTargetQueueArn, targetChoiceSource, TARGET_READS } from '../target-sources';

const KINDS = [
  {
    value: 'sqs',
    label: 'SQS queue',
    description: "The emulator delivers only when the queue's policy allows events.amazonaws.com to send messages.",
  },
  {
    value: 'sns',
    label: 'SNS topic',
    description: "The emulator delivers only when the topic's policy allows events.amazonaws.com to publish.",
  },
  {
    value: 'logs',
    label: 'CloudWatch Logs log group',
    description:
      'The emulator delivers only when a CloudWatch Logs resource policy allows events.amazonaws.com to create log streams and put log events. Each event is written to a log stream named after the rule.',
  },
] satisfies (SelectProps.Option & { value: TargetKind })[];

const INPUT_KINDS = [
  { value: 'matched', label: 'Matched event', description: 'The whole event, as JSON.' },
  { value: 'constant', label: 'Constant', description: 'The same JSON text for every event.' },
  {
    value: 'path',
    label: 'Part of the event',
    description: 'The part of the event a JSON path names, such as $.detail.',
  },
] satisfies (SelectProps.Option & { value: TargetInputKind })[];

const RESOURCE_FIELDS = {
  sqs: { label: 'Queue', things: 'queues', placeholder: 'Choose a queue' },
  sns: { label: 'Topic', things: 'topics', placeholder: 'Choose a topic' },
  logs: { label: 'Log group', things: 'log groups', placeholder: 'Choose a log group' },
};

function QueueArnRead({
  connection,
  url,
  onArn,
}: {
  connection: AreaConnection;
  url: string;
  onArn: (arn: string) => void;
}) {
  const endpoint = connection.engineOrigin;
  const query = useQuery({
    queryKey: ['events', TARGET_READS.queueArn, endpoint, url],
    queryFn: ({ signal }) => (endpoint === undefined ? noEndpoint() : getTargetQueueArn(endpoint, url, signal)),
    enabled: endpoint !== undefined,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const publish = useEffectEvent(onArn);
  useEffect(() => {
    if (query.data !== undefined && !query.isFetching) publish(query.data);
  }, [query.data, query.isFetching]);

  if (query.isFetching) return <StatusIndicator type="loading">Reading queue ARN</StatusIndicator>;
  if (!query.isError) return null;
  const failure = readFailureState(failureOf(query.error, TARGET_READS.queueArn), connection, 'queue ARN');
  return <ReadFailure state={failure} onRetry={() => void query.refetch()} />;
}

export interface TargetFieldsRef {
  focus: (field: TargetField) => void;
}

interface TargetFieldsProps {
  connection: AreaConnection;
  draft: TargetDraft;
  errors?: TargetErrors | undefined;
  disabled?: boolean | undefined;
  onChange: (update: (current: TargetDraft) => TargetDraft) => void;
  ref?: Ref<TargetFieldsRef> | undefined;
}

export function TargetFields({ connection, draft, errors = {}, disabled = false, onChange, ref }: TargetFieldsProps) {
  const id = useRef<InputProps.Ref>(null);
  const kind = useRef<SelectProps.Ref>(null);
  const resource = useRef<SelectProps.Ref>(null);
  const messageGroupId = useRef<InputProps.Ref>(null);
  const input = useRef<TextareaProps.Ref>(null);
  const path = useRef<InputProps.Ref>(null);
  useImperativeHandle(ref, () => ({
    focus(field) {
      const controls = { id, kind, resource, messageGroupId, input, path };
      controls[field].current?.focus();
    },
  }));

  const resourceField = draft.kind === undefined ? undefined : RESOURCE_FIELDS[draft.kind];
  const queueUrl = draft.kind === 'sqs' ? draft.resource?.value : undefined;

  return (
    <SpaceBetween size="m">
      <FormField label="Target ID" constraintText={TARGET_ID_CONSTRAINT} errorText={errors.id}>
        <Input
          ref={id}
          disabled={disabled}
          value={draft.id}
          onChange={({ detail }) => onChange((current) => ({ ...current, id: detail.value }))}
        />
      </FormField>
      <FormField label="Target kind" errorText={errors.kind}>
        <Select
          ref={kind}
          disabled={disabled}
          options={KINDS}
          selectedOption={KINDS.find((option) => option.value === draft.kind) ?? null}
          placeholder="Choose a target kind"
          onChange={({ detail }) => {
            const next = KINDS.find((option) => option.value === detail.selectedOption.value);
            if (next) onChange((current) => chooseTargetKind(current, next.value));
          }}
        />
      </FormField>
      {draft.kind !== undefined && resourceField !== undefined && (
        <SpaceBetween size="xs">
          <div inert={disabled}>
            <FormField label={resourceField.label} errorText={errors.resource}>
              <ChoiceSelect
                key={draft.kind}
                selectRef={resource}
                source={targetChoiceSource(draft.kind, connection.engineOrigin)}
                connection={connection}
                things={resourceField.things}
                placeholder={resourceField.placeholder}
                value={draft.resource}
                onChange={(choice) => onChange((current) => chooseTargetResource(current, choice))}
              />
            </FormField>
          </div>
          {queueUrl !== undefined && (
            <QueueArnRead
              key={queueUrl}
              url={queueUrl}
              connection={connection}
              onArn={(arn) => onChange((current) => setTargetQueueArn(current, queueUrl, arn))}
            />
          )}
        </SpaceBetween>
      )}
      {isFifoTarget(draft) && (
        <FormField label="Message group ID" description="Required for a FIFO queue." errorText={errors.messageGroupId}>
          <Input
            ref={messageGroupId}
            disabled={disabled}
            value={draft.messageGroupId}
            onChange={({ detail }) => onChange((current) => ({ ...current, messageGroupId: detail.value }))}
          />
        </FormField>
      )}
      <FormField label="What the target receives">
        <Select
          disabled={disabled}
          options={INPUT_KINDS}
          selectedOption={INPUT_KINDS.find((option) => option.value === draft.inputKind) ?? null}
          onChange={({ detail }) => {
            const next = INPUT_KINDS.find((option) => option.value === detail.selectedOption.value);
            if (next) onChange((current) => ({ ...current, inputKind: next.value }));
          }}
        />
      </FormField>
      {draft.inputKind === 'constant' && (
        <FormField label="JSON text" errorText={errors.input}>
          <Textarea
            ref={input}
            disabled={disabled}
            value={draft.input}
            onChange={({ detail }) => onChange((current) => ({ ...current, input: detail.value }))}
          />
        </FormField>
      )}
      {draft.inputKind === 'path' && (
        <FormField label="JSON path" errorText={errors.path}>
          <Input
            ref={path}
            disabled={disabled}
            value={draft.path}
            onChange={({ detail }) => onChange((current) => ({ ...current, path: detail.value }))}
          />
        </FormField>
      )}
    </SpaceBetween>
  );
}
