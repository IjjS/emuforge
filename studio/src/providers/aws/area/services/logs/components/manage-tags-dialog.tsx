import Alert from '@cloudscape-design/components/alert';
import AttributeEditor from '@cloudscape-design/components/attribute-editor';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useRef, useState } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { AreaModal } from '../../../components/area-modal';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem, ReadFailure, readFailureState } from '../../../components/failure-states';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { GROUP_SETTINGS_OPERATIONS as OPERATIONS, PartialTagSaveError, saveLogGroupTags } from '../group-settings-api';
import type { useLogGroupTags } from '../queries';
import { MAX_TAGS, TAG_LIMIT_MESSAGE, tagChanges, tagsToRecord, validateTags, type LogGroupTag } from '../tags';

interface ManageTagsDialogProps {
  connection: AreaConnection;
  endpoint: string;
  name: string;
  initialTags: Record<string, string>;
  tags: ReturnType<typeof useLogGroupTags>;
  unavailable: ReadonlySet<string>;
  onUnavailable: (operation: string) => void;
  onSaved: () => void;
  onDismiss: () => void;
}

export function ManageTagsDialog({
  connection,
  endpoint,
  name,
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
  const [draft, setDraft] = useState(() => Object.entries(initialTags).map(([key, value]) => ({ key, value })));
  const [tried, setTried] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<RequestFailure>();
  const [partial, setPartial] = useState<string>();
  const errors = tried ? validateTags(draft) : undefined;
  const changes = tags.value === undefined ? undefined : tagChanges(tags.value, tagsToRecord(draft));
  const writes = [
    ...(changes?.remove.length ? [OPERATIONS.untag] : []),
    ...(changes && Object.keys(changes.put).length > 0 ? [OPERATIONS.tag] : []),
  ];
  // A reopened editor names the unavailable operation before an edit determines which writes are needed.
  const unsupported = (writes.length === 0 ? [OPERATIONS.untag, OPERATIONS.tag] : writes).find((operation) =>
    unavailable.has(operation),
  );
  const lastFailure = failure?.kind === 'not-implemented' && changes !== undefined ? undefined : failure;
  const shownFailure: RequestFailure | undefined =
    unsupported === undefined ? lastFailure : { kind: 'not-implemented', operation: unsupported };
  const refusingOperation = shownFailure?.operation;
  const feedback = shownFailure && refusingOperation && actionFailureItem(shownFailure, refusingOperation, endpoint);
  const readFailure = tags.failure && readFailureState(tags.failure, connection, 'log group tags');

  async function save() {
    if (busy.current || changes === undefined || unsupported !== undefined) return;
    setTried(true);
    const validation = validateTags(draft);
    const invalidRow = validation.rows.findIndex(({ key, value }) => key !== undefined || value !== undefined);
    if (invalidRow >= 0) {
      const part = validation.rows[invalidRow]?.key === undefined ? 'value' : 'key';
      fields.current.get(`${invalidRow.toString()}-${part}`)?.focus();
      return;
    }
    if (validation.limit !== undefined) return;
    if (changes.remove.length === 0 && Object.keys(changes.put).length === 0) {
      onDismiss();
      return;
    }

    const signal = pageSignal();
    busy.current = true;
    setPending(true);
    setFailure(undefined);
    try {
      await saveLogGroupTags(endpoint, name, changes, signal);
    } catch (error) {
      if (signal.aborted) return;
      const appliedRemovals = error instanceof PartialTagSaveError;
      const operation = appliedRemovals || changes.remove.length === 0 ? OPERATIONS.tag : OPERATIONS.untag;
      const refusal = failureOf(appliedRemovals ? error.cause : error, operation);
      if (refusal.kind === 'not-implemented') onUnavailable(operation);
      setFailure(refusal);
      if (appliedRemovals) {
        setPartial(error.message);
        tags.refresh();
      }
      busy.current = false;
      setPending(false);
      return;
    }
    if (!signal.aborted) onSaved();
  }

  function field(tag: LogGroupTag, index: number, part: keyof LogGroupTag) {
    const id = `${index.toString()}-${part}`;
    return (
      <Input
        ref={(input) => {
          if (input === null) fields.current.delete(id);
          else fields.current.set(id, input);
        }}
        value={tag[part]}
        disabled={pending}
        autoComplete={false}
        spellcheck={false}
        onChange={({ detail }) => {
          setDraft((current) => current.map((row, at) => (at === index ? { ...row, [part]: detail.value } : row)));
        }}
      />
    );
  }

  const dismiss = () => {
    if (!busy.current) onDismiss();
  };

  return (
    <AreaModal
      visible
      header="Manage tags"
      closeAriaLabel="Close dialog"
      onDismiss={dismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={pending} onClick={dismiss}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={pending}
              disabled={changes === undefined || unsupported !== undefined}
              onClick={() => void save()}
            >
              Save
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {feedback && (
          <div role="alert">
            <Alert type={feedback.type} header={feedback.header}>
              {(shownFailure?.kind === 'engine-did-not-answer' || shownFailure?.kind === 'emulator-did-not-answer') &&
                `${refusingOperation} failed. `}
              {feedback.content}
            </Alert>
          </div>
        )}
        {partial !== undefined && <Alert type="warning">{partial}</Alert>}
        {tags.loading && <StatusIndicator type="loading">Loading tags</StatusIndicator>}
        {readFailure && (
          <div role="alert">
            <Box variant="strong">ListTagsLogGroup</Box>
            <ReadFailure state={readFailure} onRetry={tags.refresh} />
          </div>
        )}
        <FormField errorText={errors?.limit}>
          <AttributeEditor
            items={draft}
            addButtonText="Add tag"
            removeButtonText="Remove"
            removeButtonAriaLabel={(tag) => (tag.key === '' ? 'Remove tag' : `Remove tag ${tag.key}`)}
            disableAddButton={pending || draft.length >= MAX_TAGS}
            isItemRemovable={() => !pending}
            additionalInfo={draft.length >= MAX_TAGS ? TAG_LIMIT_MESSAGE : undefined}
            onAddButtonClick={() => setDraft((current) => [...current, { key: '', value: '' }])}
            onRemoveButtonClick={({ detail }) =>
              setDraft((current) => current.filter((_, at) => at !== detail.itemIndex))
            }
            definition={[
              {
                label: 'Key',
                control: (tag, index) => field(tag, index, 'key'),
                errorText: (_, index) => errors?.rows[index]?.key,
              },
              {
                label: 'Value',
                control: (tag, index) => field(tag, index, 'value'),
                errorText: (_, index) => errors?.rows[index]?.value,
              },
            ]}
          />
        </FormField>
      </SpaceBetween>
    </AreaModal>
  );
}
