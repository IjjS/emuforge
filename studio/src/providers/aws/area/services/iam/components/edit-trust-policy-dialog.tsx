import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState } from 'react';

import { AreaModal } from '../../../components/area-modal';
import type { FlashItem } from '../../../components/page-flash';
import { usePageFlash } from '../../../components/page-flash';
import { isOneJsonValue } from '../document-text';
import { failureOf, useUpdateTrustPolicy } from '../queries';
import { DocumentEditor } from './document-editor';
import { actionFailureItem } from './failures';
import { Quoted } from './quoted';

// "Edit trust policy" of a role's tab "Trust relationships" (issue 535, task 4): the document as the tab shows it,
// edited as JSON text. Studio checks only that the text is one JSON value; "Save changes" sends one
// `UpdateAssumeRolePolicy` with the text as typed. A refusal stays in the dialog with what was typed; a success closes
// it, reports in the page's Flashbar, and the role is read again (`useUpdateTrustPolicy`).

/** The error text of a trust policy that is not one JSON value (requirement, "EmuForge's own text"). */
export const TRUST_NOT_JSON_TEXT = 'Enter the trust policy as one JSON value.';

export interface EditTrustPolicyDialogProps {
  /** The role's name. */
  role: string;
  /** The document as the tab shows it: the editor's text at start. */
  document: string;
  /** The engine's origin. */
  engineOrigin: string | undefined;
  /** Called when the dialog closes: "Cancel", Esc, or a saved change. */
  onClose: () => void;
}

/** The dialog "Edit trust policy". While a save is in flight a second press sends nothing. */
export function EditTrustPolicyDialog({ role, document, engineOrigin, onClose }: EditTrustPolicyDialogProps) {
  const [text, setText] = useState(document);
  const [errorText, setErrorText] = useState<string>();
  const [failure, setFailure] = useState<FlashItem>();
  const flash = usePageFlash();
  const update = useUpdateTrustPolicy(engineOrigin);
  const pending = update.isPending;

  const handleDismiss = () => {
    if (!pending) {
      onClose();
    }
  };

  const handleSave = () => {
    if (pending) {
      return;
    }
    if (!isOneJsonValue(text)) {
      setErrorText(TRUST_NOT_JSON_TEXT);
      return;
    }
    setErrorText(undefined);
    setFailure(undefined);
    update.mutate(
      { role, document: text },
      {
        onSuccess: () => {
          flash.show([{ type: 'success', content: <Quoted before="Trust policy of " name={role} after=" saved." /> }]);
          onClose();
        },
        onError: (error) => {
          setFailure(actionFailureItem(failureOf(error), `Saving the trust policy of ${role}`, engineOrigin));
        },
      },
    );
  };

  return (
    <AreaModal
      visible
      size="large"
      header="Edit trust policy"
      closeAriaLabel="Close modal"
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={handleDismiss}>
              Cancel
            </Button>
            <Button variant="primary" loading={pending} loadingText="Saving changes" onClick={handleSave}>
              Save changes
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <DocumentEditor
          label="Trust policy"
          description="Who may assume this role, as one JSON value. It is sent as typed."
          errorText={errorText}
          value={text}
          onChange={setText}
          disabled={pending}
        />
        {failure !== undefined && (
          <Alert type={failure.type} header={failure.header}>
            {failure.content}
          </Alert>
        )}
      </SpaceBetween>
    </AreaModal>
  );
}
