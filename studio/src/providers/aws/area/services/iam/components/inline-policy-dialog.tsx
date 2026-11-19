import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useState } from 'react';

import { AreaModal } from '../../../components/area-modal';
import { DiscardDialog, type DiscardAnswer } from '../../../components/discard-dialog';
import type { AreaConnection } from '../../../components/emulator-line';
import type { FlashItem } from '../../../components/page-flash';
import { usePageFlash } from '../../../components/page-flash';
import { ValueText } from '../../../components/value-text';
import { documentErrorText, POLICY_SKELETON } from '../document-text';
import { failureOf, useInlinePolicyDocument, usePutRolePolicy } from '../queries';
import { DocumentEditor } from './document-editor';
import { actionFailureItem, readFailureState } from './failures';
import { ReadFailure } from './states';

// "Add inline policy" and an inline policy's "Edit" on a role's tab "Permissions" (issue 535, task 3). Add: a name
// and the document, starting from the skeleton; Studio checks the name's rule, that the role has no inline policy of
// that name among those read (the emulator would replace it without a word) and that the text is one JSON value,
// and sends nothing otherwise. Edit: the name fixed, the document as `GetRolePolicy` returns it, read as the dialog
// opens. Both send `PutRolePolicy` with the text as typed; a refusal stays in the dialog with what was typed. Closing
// it while the name or the document differ from what it opened with asks first, as "Create policy" does.

const NAME_RULE = '1 to 128 characters: letters (A-Z, a-z), digits and the characters + = , . @ _ -.';
const NAME_MAX = 128;
const NAME_ALPHABET = /^[A-Za-z0-9+=,.@_-]+$/;
const NAME_EMPTY = 'Enter a policy name.';
const NAME_TOO_LONG = 'The name can have up to 128 characters.';
const NAME_BAD_ALPHABET = 'The name can have only letters, digits and the characters + = , . @ _ -.';

/** The name's message, or `undefined` when the name may be sent. */
function inlineNameErrorText(name: string, role: string, held: readonly string[]): string | undefined {
  if (name === '') {
    return NAME_EMPTY;
  }
  if (name.length > NAME_MAX) {
    return NAME_TOO_LONG;
  }
  if (!NAME_ALPHABET.test(name)) {
    return NAME_BAD_ALPHABET;
  }
  if (held.includes(name)) {
    return `${role} already has an inline policy named ${name}.`;
  }
  return undefined;
}

/** What the dialog is open for: a new inline policy, or the one named. */
export type InlinePolicyMode = { kind: 'add'; held: readonly string[] } | { kind: 'edit'; name: string };

export interface InlinePolicyDialogProps {
  role: string;
  mode: InlinePolicyMode;
  connection: AreaConnection;
  /** Called when the dialog closes: "Cancel", Esc, or the policy saved. */
  onClose: () => void;
}

interface Errors {
  name?: string | undefined;
  document?: string | undefined;
}

/** The refusal shown above the buttons. */
function FailureAlert({ item }: { item: FlashItem }) {
  return (
    <Alert type={item.type === 'info' ? 'info' : 'error'} header={item.header}>
      {item.content}
    </Alert>
  );
}

/** The dialog "Add inline policy" or "Edit {name}". */
export function InlinePolicyDialog({ role, mode, connection, onClose }: InlinePolicyDialogProps) {
  const engineOrigin = connection.engineOrigin;
  const editing = mode.kind === 'edit' ? mode.name : undefined;
  const [name, setName] = useState('');
  const [text, setText] = useState(editing === undefined ? POLICY_SKELETON : '');
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<FlashItem>();
  const flash = usePageFlash();
  const put = usePutRolePolicy(engineOrigin);
  const pending = put.isPending;

  const document = useInlinePolicyDocument({
    endpoint: engineOrigin,
    role,
    policy: editing ?? '',
    enabled: editing !== undefined,
  });
  // The editor takes the document once, when it first arrives; what is typed afterwards is the developer's.
  const [taken, setTaken] = useState(false);
  // The document the editor opened with: the skeleton, or the one read; what is typed is told from it.
  const [startText, setStartText] = useState(editing === undefined ? POLICY_SKELETON : '');
  if (editing !== undefined && !taken && document.read?.kind === 'found' && !document.loading) {
    setTaken(true);
    setText(document.read.text);
    setStartText(document.read.text);
  }
  const ready = editing === undefined || taken;

  // "Discard what you entered?" is open: Esc, "Close", a click beside the dialog or "Cancel" asked to close while the
  // name or the document differ from what the dialog opened with.
  const [asking, setAsking] = useState(false);
  const changed = name !== '' || (ready && text !== startText);

  const handleDismiss = () => {
    if (pending || asking) {
      return;
    }
    if (changed) {
      setAsking(true);
      return;
    }
    onClose();
  };

  const handleDiscardAnswer = (answer: DiscardAnswer) => {
    setAsking(false);
    if (answer === 'discard') {
      onClose();
    }
  };

  const handleSave = () => {
    if (pending || !ready) {
      return;
    }
    const policy = editing ?? name;
    const found: Errors = {
      ...(mode.kind === 'add' && { name: inlineNameErrorText(name, role, mode.held) }),
      document: documentErrorText(text),
    };
    setErrors(found);
    if (found.name !== undefined || found.document !== undefined) {
      return;
    }
    setFailure(undefined);
    put.mutate(
      { role, name: policy, document: text },
      {
        onSuccess: () => {
          flash.show([
            {
              type: 'success',
              content:
                editing === undefined
                  ? `Inline policy ${policy} added to ${role}.`
                  : `Inline policy ${policy} of ${role} saved.`,
            },
          ]);
          onClose();
        },
        onError: (error) => {
          setFailure(
            actionFailureItem(
              failureOf(error),
              editing === undefined ? `Adding ${policy} to ${role}` : `Saving ${policy}`,
              engineOrigin,
            ),
          );
        },
      },
    );
  };

  let body;
  if (ready) {
    body = (
      <DocumentEditor
        label="Policy document"
        errorText={errors.document}
        value={text}
        disabled={pending}
        onChange={(next) => {
          setText(next);
        }}
      />
    );
  } else if (document.failure !== undefined && !document.loading) {
    body = (
      <ReadFailure
        state={readFailureState(document.failure, connection, 'policy document')}
        onRetry={document.refresh}
      />
    );
  } else if (document.read?.kind === 'not-found' && !document.loading) {
    body = (
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            Policy not found
          </Box>
          <Box variant="p" color="inherit">
            {`${role} has no inline policy named ${editing ?? ''} in the emulator.`}
          </Box>
        </SpaceBetween>
        <Box margin={{ top: 's' }}>
          <Button onClick={document.refresh}>Retry</Button>
        </Box>
      </Box>
    );
  } else {
    body = <StatusIndicator type="loading">Loading the policy document</StatusIndicator>;
  }

  const action = editing === undefined ? 'Add policy' : 'Save changes';
  const actionInFlight = editing === undefined ? 'Adding' : 'Saving changes';

  return (
    <>
      <AreaModal
        visible
        size="large"
        header={editing === undefined ? 'Add inline policy' : `Edit ${editing}`}
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
                disabled={!ready}
                loading={pending}
                loadingText={actionInFlight}
                onClick={handleSave}
              >
                {action}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {editing === undefined ? (
            <FormField label="Policy name" constraintText={NAME_RULE} errorText={errors.name}>
              <Input
                value={name}
                disabled={pending}
                invalid={errors.name !== undefined}
                onChange={({ detail }) => {
                  setName(detail.value);
                }}
              />
            </FormField>
          ) : (
            <FormField label="Policy name">
              <ValueText kind="name" value={editing} />
            </FormField>
          )}
          {body}
          {failure !== undefined && <FailureAlert item={failure} />}
        </SpaceBetween>
      </AreaModal>
      {asking && <DiscardDialog visible onAnswer={handleDiscardAnswer} />}
    </>
  );
}
