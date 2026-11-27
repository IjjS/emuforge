import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import AttributeEditor from '@cloudscape-design/components/attribute-editor';
import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import type { Tag } from '@aws-sdk/client-cloudwatch';
import { useLayoutEffect, useRef, useState } from 'react';

import { refusalMessage, reportedServiceCode, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaModal } from '../../../components/area-modal';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem, Code, readFailureState } from '../../../components/failure-states';
import { useFollow } from '../../../components/use-follow';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
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

const TAG_OPERATIONS = [UNTAG_RESOURCE, TAG_RESOURCE] as const;

interface ManageTagsDialogProps {
  endpoint: string;
  connection: AreaConnection;
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
  connection,
  arn,
  initialTags,
  tags,
  unavailable,
  onUnavailable,
  onSaved,
  onDismiss,
}: ManageTagsDialogProps) {
  const pageSignal = usePageSignal();
  const follow = useFollow();
  const busy = useRef(false);
  const saveButton = useRef<ButtonProps.Ref>(null);
  const cancelButton = useRef<ButtonProps.Ref>(null);
  const retryButton = useRef<ButtonProps.Ref>(null);
  const writeFailureAlert = useRef<AlertProps.Ref>(null);
  const fields = useRef(new Map<string, InputProps.Ref>());
  const [opened] = useState(() => tagRows(initialTags));
  const [draft, setDraft] = useState(opened);
  const [latest, setLatest] = useState(opened);
  const [tried, setTried] = useState(false);
  const [pending, setPending] = useState(false);
  const [reading, setReading] = useState(false);
  const [failedRead, setFailedRead] = useState<{ failure?: RequestFailure }>();
  const [retrySucceeded, setRetrySucceeded] = useState(false);
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
  const serviceCode = refusal && reportedServiceCode(refusal);
  const partialResult = removalsSaved && refusal && (
    <>
      The removals were saved. The added and changed tags were not: {refusal.operation}:{' '}
      {partialReason ?? feedback?.header}
      {serviceCode !== undefined && serviceCode !== partialReason && (
        <>
          {' '}
          (<Code>{serviceCode}</Code>)
        </>
      )}
    </>
  );
  const writeFailureDetail = feedback && refusal && (
    <>
      {(refusal.kind === 'engine-did-not-answer' || refusal.kind === 'emulator-did-not-answer') &&
        `${refusal.operation} failed. `}
      {feedback.content}
      {refusal.kind === 'access-denied' && serviceCode !== undefined && (
        <>
          {' '}
          (<Code>{serviceCode}</Code>)
        </>
      )}
    </>
  );
  const readState = failedRead?.failure && readFailureState(failedRead.failure, connection, 'tags');
  const inFlight = pending || reading;
  const saveDisabled = failedRead !== undefined || (!inFlight && unsupported !== undefined);

  useLayoutEffect(() => {
    if (inFlight || !saveFailure) return;
    if (failedRead) {
      retryButton.current?.focus();
    } else if (!retrySucceeded) {
      writeFailureAlert.current?.focus();
    } else if (saveFailure.refusal.kind === 'not-implemented') {
      cancelButton.current?.focus();
    } else {
      saveButton.current?.focus();
    }
  }, [failedRead, inFlight, retrySucceeded, saveFailure]);

  async function reread(signal: AbortSignal) {
    setReading(true);
    const result = await tags.refresh();
    if (signal.aborted) return;
    if (result && 'value' in result) {
      setLatest(tagRows(result.value));
      setRetrySucceeded(failedRead !== undefined);
      setFailedRead(undefined);
    } else {
      setFailedRead(result ?? {});
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
    if (busy.current || saveDisabled) return;
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
    setRetrySucceeded(false);
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
            <Button ref={cancelButton} variant="link" disabled={inFlight} onClick={handleDismiss}>
              Cancel
            </Button>
            <Button
              ref={saveButton}
              variant="primary"
              disabled={saveDisabled}
              loading={inFlight && !failedRead}
              onClick={() => void handleSave()}
            >
              Save
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {partialResult && (
          <Alert type="warning" ref={writeFailureAlert}>
            {partialResult}
          </Alert>
        )}
        {feedback && refusal && partialReason === undefined && (
          <Alert type={feedback.type} header={feedback.header} ref={partialResult ? undefined : writeFailureAlert}>
            {writeFailureDetail}
          </Alert>
        )}
        {reading && <StatusIndicator type="loading">Loading tags</StatusIndicator>}
        {failedRead && (
          <Alert
            type="error"
            action={
              <Button ref={retryButton} loading={reading} onClick={() => void handleRetry()}>
                Retry
              </Button>
            }
          >
            <SpaceBetween size="xxs">
              <div>The tags could not be read again.</div>
              {readState && (
                <SpaceBetween size="xxs">
                  <StatusIndicator type={readState.type}>{readState.first}</StatusIndicator>
                  {readState.detail}
                  {readState.recovery && (
                    <Link href="/" onFollow={follow}>
                      Connection status
                    </Link>
                  )}
                </SpaceBetween>
              )}
            </SpaceBetween>
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
      <div className="aws-area-announcer" role="alert" aria-atomic="true">
        {!inFlight &&
          !failedRead &&
          !retrySucceeded &&
          saveFailure &&
          (partialResult || (
            <>
              {feedback?.header} {writeFailureDetail}
            </>
          ))}
        {failedRead && !reading && (
          <>
            {partialResult}
            {partialResult && ' '}
            The tags could not be read again. Choose Retry to read the tags before saving.
          </>
        )}
      </div>
    </AreaModal>
  );
}
