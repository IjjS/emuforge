import Alert from '@cloudscape-design/components/alert';
import AttributeEditor from '@cloudscape-design/components/attribute-editor';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import type { Tag } from '@aws-sdk/client-cloudwatch';
import { useRef, useState } from 'react';

import { refusalMessage, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaModal } from '../../../components/area-modal';
import { actionFailureItem } from '../../../components/failure-states';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import type { useAlarmTags } from '../alarm-queries';
import { SaveAlarmTagsError, TAG_RESOURCE, UNTAG_RESOURCE, saveAlarmTags, type TagOperation } from '../tags-api';
import {
  MAX_TAGS,
  TAG_LIMIT_MESSAGE,
  changesOwed,
  tagChanges,
  tagRows,
  tagsAddedOutside,
  validateTags,
  type TagRow,
} from '../tags';
import { ValueText } from '../../../components/value-text';

const TAG_OPERATIONS = [UNTAG_RESOURCE, TAG_RESOURCE] as const;

interface ManageTagsDialogProps {
  endpoint: string;
  arn: string;
  initialTags: Tag[];
  tags: ReturnType<typeof useAlarmTags>;
  unavailable: ReadonlySet<TagOperation>;
  onUnavailable: (operation: TagOperation) => void;
  onSaved: () => void;
  onDismiss: () => void;
}

export function ManageTagsDialog({
  endpoint,
  arn,
  initialTags,
  tags,
  unavailable,
  onUnavailable,
  onSaved,
  onDismiss,
}: ManageTagsDialogProps) {
  const pageSignal = usePageSignal();
  const busy = useRef(false);
  const fields = useRef(new Map<string, InputProps.Ref>());
  const [opened] = useState(() => tagRows(initialTags));
  const [draft, setDraft] = useState(opened);
  const [latest, setLatest] = useState(opened);
  const [tried, setTried] = useState(false);
  const [pending, setPending] = useState(false);
  const [reading, setReading] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [saveFailure, setSaveFailure] = useState<{ refusal: RequestFailure; removalsSaved: boolean }>();

  const current = tags.value === undefined ? latest : tagRows(tags.value);
  const owed = changesOwed(tagChanges(opened, draft), current);
  const outside = tagsAddedOutside(opened, draft, current);
  const errors = tried ? validateTags(draft) : undefined;
  const writes: TagOperation[] = [];
  if (owed.remove.length > 0) writes.push(UNTAG_RESOURCE);
  if (owed.put.length > 0) writes.push(TAG_RESOURCE);
  const unsupported = (writes.length === 0 ? TAG_OPERATIONS : writes).find(
    (operation) =>
      unavailable.has(operation) ||
      (saveFailure?.refusal.kind === 'not-implemented' && saveFailure.refusal.operation === operation),
  );
  const refusal: RequestFailure | undefined =
    unsupported && unsupported !== saveFailure?.refusal.operation
      ? { kind: 'not-implemented', operation: unsupported }
      : saveFailure?.refusal;
  const removalsSaved = saveFailure?.removalsSaved && saveFailure.refusal === refusal;
  const feedback = refusal && actionFailureItem(refusal, refusal.operation, endpoint);
  const partialReason =
    removalsSaved && refusal
      ? (refusalMessage(refusal) ?? (refusal.kind === 'other' ? refusal.code : undefined))
      : undefined;
  const disabled = pending || reading || readFailed || unsupported !== undefined;

  async function reread(signal: AbortSignal) {
    setReading(true);
    const result = await tags.refresh();
    if (signal.aborted) return;
    if (result && 'value' in result) {
      setLatest(tagRows(result.value));
      setReadFailed(false);
    } else {
      setReadFailed(true);
    }
    setReading(false);
    busy.current = false;
  }

  async function handleRetry() {
    if (busy.current) return;
    busy.current = true;
    await reread(pageSignal());
  }

  async function handleSave() {
    if (busy.current || disabled) return;
    setTried(true);
    const validation = validateTags(draft);
    const invalidRow = validation.rows.findIndex(({ key, value }) => key !== undefined || value !== undefined);
    if (invalidRow >= 0) {
      const part = validation.rows[invalidRow]?.key === undefined ? 'value' : 'key';
      fields.current.get(`${invalidRow.toString()}-${part}`)?.focus();
    }
    if (invalidRow >= 0 || validation.limit !== undefined) return;
    const [firstWrite] = writes;
    if (firstWrite === undefined) {
      onDismiss();
      return;
    }

    const signal = pageSignal();
    busy.current = true;
    setPending(true);
    setSaveFailure(undefined);
    try {
      await saveAlarmTags(endpoint, arn, owed, signal);
    } catch (error) {
      if (signal.aborted) return;
      const operation = error instanceof SaveAlarmTagsError ? error.operation : firstWrite;
      const refusal = failureOf(error instanceof SaveAlarmTagsError ? error.cause : error, operation);
      if (refusal.kind === 'not-implemented') onUnavailable(operation);
      setSaveFailure({ refusal, removalsSaved: error instanceof SaveAlarmTagsError && error.removalsSaved });
      setPending(false);
      await reread(signal);
      return;
    }
    if (!signal.aborted) onSaved();
  }

  const handleDismiss = () => {
    if (!busy.current) onDismiss();
  };

  function field(row: TagRow, index: number, part: keyof TagRow) {
    const id = `${index.toString()}-${part}`;
    return (
      <Input
        ref={(input) => {
          if (input === null) fields.current.delete(id);
          else fields.current.set(id, input);
        }}
        value={row[part]}
        disabled={pending || reading}
        autoComplete={false}
        spellcheck={false}
        onChange={({ detail }) =>
          setDraft((rows) => rows.map((item, at) => (at === index ? { ...item, [part]: detail.value } : item)))
        }
      />
    );
  }

  return (
    <AreaModal
      visible
      size="large"
      header="Manage tags"
      closeAriaLabel="Close dialog"
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={pending || reading} onClick={handleDismiss}>
              Cancel
            </Button>
            <Button variant="primary" disabled={disabled} loading={pending} onClick={() => void handleSave()}>
              Save
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {removalsSaved && refusal && (
          <Alert type="warning">
            The removals were saved. The added and changed tags were not: {refusal.operation}:{' '}
            {partialReason ?? feedback?.header}
          </Alert>
        )}
        {feedback && refusal && partialReason === undefined && (
          <Alert type={feedback.type} header={feedback.header}>
            {(refusal.kind === 'engine-did-not-answer' || refusal.kind === 'emulator-did-not-answer') &&
              `${refusal.operation} failed. `}
            {feedback.content}
          </Alert>
        )}
        {reading && <StatusIndicator type="loading">Loading tags</StatusIndicator>}
        {readFailed && (
          <Alert
            type="error"
            action={
              <Button disabled={reading} onClick={() => void handleRetry()}>
                Retry
              </Button>
            }
          >
            The tags could not be read again.
          </Alert>
        )}
        <FormField errorText={errors?.limit}>
          <AttributeEditor
            items={draft}
            addButtonText="Add tag"
            removeButtonText="Remove"
            removeButtonAriaLabel={({ key }) => (key === '' ? 'Remove tag' : `Remove tag ${key}`)}
            disableAddButton={pending || reading || draft.length >= MAX_TAGS}
            isItemRemovable={() => !pending && !reading}
            additionalInfo={draft.length >= MAX_TAGS ? TAG_LIMIT_MESSAGE : undefined}
            onAddButtonClick={() => setDraft((rows) => [...rows, { key: '', value: '' }])}
            onRemoveButtonClick={({ detail }) => setDraft((rows) => rows.filter((_, at) => at !== detail.itemIndex))}
            definition={[
              {
                label: 'Key',
                control: (row, index) => field(row, index, 'key'),
                errorText: (_, index) => errors?.rows[index]?.key,
              },
              {
                label: 'Value',
                control: (row, index) => field(row, index, 'value'),
                errorText: (_, index) => errors?.rows[index]?.value,
              },
            ]}
          />
        </FormField>
        {outside.length > 0 && (
          <div>
            <Box variant="h3">Added outside this dialog</Box>
            <dl>
              {outside.map(({ key, value }) => (
                <div key={key}>
                  <dt>
                    <ValueText kind="name" value={key} />
                  </dt>
                  <dd>
                    <ValueText kind="text" value={value} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </SpaceBetween>
    </AreaModal>
  );
}
