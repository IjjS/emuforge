import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState } from 'react';

import { AreaModal } from '../../../components/area-modal';
import type { AreaConnection } from '../../../components/emulator-line';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { documentErrorText } from '../document-text';
import { failureOf, useCreatePolicyVersion, useManagedPolicyDocument } from '../queries';
import { DocumentEditor } from './document-editor';
import { actionFailureItem } from './failures';
import { PolicyDocument } from './policy-document';

// "Edit" of a customer managed policy's document (issue 535, design "Task 6", point 3): the default version's document
// as the emulator returns it, in the area's modal. "Save changes" checks only that the text is one JSON value, then
// sends `CreatePolicyVersion` with `SetAsDefault`. A refusal (a sixth version, a malformed document) stays in the
// dialog with what was typed; the success closes it and is reported in the area's Flashbar.

export interface EditPolicyDialogProps {
  policy: { arn: string; name: string };
  connection: AreaConnection;
  /** Called with the new version's id once the emulator saved it. */
  onSaved: (versionId: string) => void;
  /** Called when the dialog closes: "Cancel", Esc, or a saved version. */
  onClose: () => void;
}

/** The result shown once a version is saved. */
function savedVersionText(name: string, versionId: string): string {
  return `${name} saved as version ${versionId}, now the default.`;
}

/** The dialog "Edit {name}". */
export function EditPolicyDialog({ policy, connection, onSaved, onClose }: EditPolicyDialogProps) {
  const flash = usePageFlash();
  const engineOrigin = connection.engineOrigin;
  const document = useManagedPolicyDocument({ endpoint: engineOrigin, arn: policy.arn, enabled: true });
  const save = useCreatePolicyVersion(engineOrigin);
  const pending = save.isPending;

  // The text as typed, from the document as read once it arrives.
  const [text, setText] = useState<string>();
  const read = document.read?.kind === 'found' ? document.read : undefined;
  if (text === undefined && read !== undefined && !document.loading) {
    setText(read.text);
  }
  const [checked, setChecked] = useState(false);
  const [failure, setFailure] = useState<FlashItem>();
  const errorText = checked && text !== undefined ? documentErrorText(text) : undefined;

  const handleDismiss = () => {
    if (!pending) {
      onClose();
    }
  };

  const handleSave = () => {
    if (pending || text === undefined) {
      return;
    }
    setChecked(true);
    if (documentErrorText(text) !== undefined) {
      return;
    }
    setFailure(undefined);
    save.mutate(
      { arn: policy.arn, document: text },
      {
        onSuccess: (versionId) => {
          flash.show([{ type: 'success', content: savedVersionText(policy.name, versionId) }]);
          onSaved(versionId);
          onClose();
        },
        onError: (error) => {
          setFailure(actionFailureItem(failureOf(error), 'Saving the policy', engineOrigin));
        },
      },
    );
  };

  return (
    <AreaModal
      visible
      size="large"
      header={`Edit ${policy.name}`}
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
              disabled={text === undefined}
              loading={pending}
              loadingText="Saving changes"
              onClick={handleSave}
            >
              Save changes
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {text === undefined ? (
          <PolicyDocument source={{ kind: 'query', query: document }} arn={policy.arn} connection={connection} />
        ) : (
          <DocumentEditor
            label="Policy document"
            description="Saving creates a new version and makes it the default."
            errorText={errorText}
            value={text}
            onChange={setText}
            disabled={pending}
          />
        )}
        {failure !== undefined && (
          <Alert type={failure.type} header={failure.header}>
            {failure.content}
          </Alert>
        )}
      </SpaceBetween>
    </AreaModal>
  );
}
