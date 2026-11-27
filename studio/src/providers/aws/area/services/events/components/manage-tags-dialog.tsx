import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useRef, useState } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { AreaModal } from '../../../components/area-modal';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem, ReadFailure, readFailureState } from '../../../components/failure-states';
import { tagChanges, tagsToRecord, validateTags } from '../../../components/tags';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import {
  BUS_SETTINGS_OPERATIONS as OPERATIONS,
  PartialTagSaveError,
  saveBusTags,
  type TagWriteOperation,
} from '../bus-settings-api';
import type { useResourceTags } from '../queries';
import { TagEditor, type TagEditorRef } from './tag-editor';

interface ManageTagsDialogProps {
  connection: AreaConnection;
  endpoint: string;
  arn: string;
  initialTags: Record<string, string>;
  tags: ReturnType<typeof useResourceTags>;
  unavailable: TagWriteOperation | undefined;
  onUnavailable: (operation: TagWriteOperation) => void;
  onSaved: () => void;
  onDismiss: () => void;
}

export function ManageTagsDialog({
  connection,
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
  const editor = useRef<TagEditorRef>(null);
  const [draft, setDraft] = useState(() => Object.entries(initialTags).map(([key, value]) => ({ key, value })));
  const [savedTags, setSavedTags] = useState(initialTags);
  const [tried, setTried] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ operation: TagWriteOperation; reason: RequestFailure }>();
  const [partial, setPartial] = useState<string>();
  const unsupported = unavailable ?? (failure?.reason.kind === 'not-implemented' ? failure.operation : undefined);
  const shownFailure =
    unsupported === undefined
      ? failure
      : { operation: unsupported, reason: { kind: 'not-implemented' as const, operation: unsupported } };
  const feedback = shownFailure && actionFailureItem(shownFailure.reason, shownFailure.operation, endpoint);
  const readFailure = tags.failure && readFailureState(tags.failure, connection, 'event bus tags');

  async function handleSave() {
    const latestTags = tags.value;
    if (busy.current || latestTags === undefined || unsupported !== undefined) return;

    setTried(true);
    const validation = validateTags(draft);
    const firstInvalid = validation.rows.findIndex(({ key, value }) => key !== undefined || value !== undefined);
    if (firstInvalid >= 0) {
      editor.current?.focus(firstInvalid, validation.rows[firstInvalid]?.key === undefined ? 'value' : 'key');
      return;
    }
    if (validation.limit !== undefined) return;
    const intended = tagChanges(savedTags, tagsToRecord(draft));
    const changes = {
      remove: intended.remove.filter((key) => Object.hasOwn(latestTags, key)),
      put: Object.fromEntries(
        Object.entries(intended.put).filter(
          ([key, value]) => !Object.hasOwn(latestTags, key) || latestTags[key] !== value,
        ),
      ),
    };
    const removing = changes.remove.length > 0;
    if (!removing && Object.keys(changes.put).length === 0) {
      onDismiss();
      return;
    }

    const signal = pageSignal();
    busy.current = true;
    setPending(true);
    setFailure(undefined);
    setPartial(undefined);
    try {
      await saveBusTags(endpoint, arn, changes, signal);
    } catch (error) {
      if (signal.aborted) return;
      const operation = error instanceof PartialTagSaveError || !removing ? OPERATIONS.tag : OPERATIONS.untag;
      const reason = failureOf(error instanceof PartialTagSaveError ? error.cause : error, operation);
      setFailure({ operation, reason });
      if (reason.kind === 'not-implemented') onUnavailable(operation);
      if (error instanceof PartialTagSaveError) {
        setSavedTags((previous) =>
          Object.fromEntries(Object.entries(previous).filter(([key]) => !changes.remove.includes(key))),
        );
        setPartial(error.message);
      }
      tags.refresh();
      busy.current = false;
      setPending(false);
      return;
    }
    if (!signal.aborted) onSaved();
  }

  function handleDismiss() {
    if (!busy.current) onDismiss();
  }

  return (
    <AreaModal
      visible
      header="Manage tags"
      closeAriaLabel="Close dialog"
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={pending} onClick={handleDismiss}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={pending}
              disabled={tags.value === undefined || unsupported !== undefined}
              onClick={() => void handleSave()}
            >
              Save
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {partial && <Alert type="warning">{partial}</Alert>}
        {feedback && (
          <div role="alert">
            <Alert type={feedback.type} header={feedback.header}>
              {(shownFailure.reason.kind === 'engine-did-not-answer' ||
                shownFailure.reason.kind === 'emulator-did-not-answer') &&
                `${shownFailure.operation} failed. `}
              {feedback.content}
            </Alert>
          </div>
        )}
        {tags.loading && <StatusIndicator type="loading">Reading tags again</StatusIndicator>}
        {readFailure && (
          <div role="alert">
            <Box variant="strong">The tags could not be read again.</Box>
            <ReadFailure state={readFailure} onRetry={tags.refresh} />
          </div>
        )}
        <TagEditor
          ref={editor}
          tags={draft}
          errors={tried ? validateTags(draft) : undefined}
          disabled={pending}
          onChange={setDraft}
        />
      </SpaceBetween>
    </AreaModal>
  );
}
