import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState, type ReactNode } from 'react';

import { AreaModal } from '../../../components/area-modal';
import type { AreaConnection } from '../../../components/emulator-line';
import { usePageFlash } from '../../../components/page-flash';
import type { IamFailure, Policy } from '../api';
import { failureOf, useAttachRolePolicies } from '../queries';
import { actionFailureItem } from './failures';
import { PolicyChoiceTable } from './permissions-step';

// "Attach policies" of a role's tab "Permissions" (issue 535, task 3): the emulator's managed policies as step 2 of
// "Create role" lists them, those the role has marked "Attached" and not to be chosen. "Attach" sends one
// `AttachRolePolicy` per chosen policy, in the order chosen, and stops at the first refusal. All attached: the dialog
// closes and the Flashbar says how many; one refused: the dialog stays and says which, with what came back and how
// many were attached before it. The role is read again either way (by the hook).

const NOTHING_CHOSEN = 'Choose at least one policy.';

/** "Attached {policy} to {role}." or "Attached {n} policies to {role}.". */
function attachedText(attached: readonly { name: string }[], role: string): string {
  const [only] = attached;
  return attached.length === 1 && only !== undefined
    ? `Attached ${only.name} to ${role}.`
    : `Attached ${String(attached.length)} policies to ${role}.`;
}

/** What the dialog shows of a refused attach: which policy, what came back, and how many went before it. */
interface Refusal {
  header: string;
  failure: IamFailure;
  before: number;
}

/**
 * The words of a refusal: the emulator's code and message as they came; for the other kinds of failure (not
 * implemented, access denied, no answer) the words the area's results use for them.
 */
function refusalWords(failure: IamFailure, engineOrigin: string | undefined): ReactNode {
  const item = actionFailureItem(failure, '', engineOrigin);
  if (failure.kind === 'other' || item.header === undefined) {
    return item.content;
  }
  return (
    <>
      {item.header}. {item.content}
    </>
  );
}

function RefusalAlert({ refusal, engineOrigin }: { refusal: Refusal; engineOrigin: string | undefined }) {
  return (
    <Alert type={refusal.failure.kind === 'not-implemented' ? 'info' : 'error'} header={refusal.header}>
      <SpaceBetween size="xxs">
        <Box variant="p" color="inherit">
          {refusalWords(refusal.failure, engineOrigin)}
        </Box>
        {refusal.before > 0 && (
          <Box variant="p" color="inherit">
            {`${String(refusal.before)} attached before it.`}
          </Box>
        )}
      </SpaceBetween>
    </Alert>
  );
}

export interface AttachPoliciesDialogProps {
  role: string;
  /** The ARNs of the managed policies the role's read lists. */
  attached: ReadonlySet<string>;
  connection: AreaConnection;
  /** Called when the dialog closes: "Cancel", Esc, or every chosen policy attached. */
  onClose: () => void;
}

/** The dialog "Attach policies to {role}". */
export function AttachPoliciesDialog({ role, attached, connection, onClose }: AttachPoliciesDialogProps) {
  const engineOrigin = connection.engineOrigin;
  const [chosen, setChosen] = useState<Policy[]>([]);
  const [nothingChosen, setNothingChosen] = useState(false);
  const [refusal, setRefusal] = useState<Refusal>();
  const flash = usePageFlash();
  const attach = useAttachRolePolicies(engineOrigin);
  const pending = attach.isPending;

  const handleDismiss = () => {
    if (!pending) {
      onClose();
    }
  };

  const handleChoose = (next: Policy[]) => {
    setChosen(next);
    if (next.length > 0) {
      setNothingChosen(false);
    }
  };

  const handleAttach = () => {
    if (pending) {
      return;
    }
    if (chosen.length === 0) {
      setNothingChosen(true);
      return;
    }
    setRefusal(undefined);
    attach.mutate(
      { role, policies: chosen.map(({ name, arn }) => ({ name, arn })) },
      {
        onSuccess: (result) => {
          if (result.failed === undefined) {
            flash.show([{ type: 'success', content: attachedText(result.attached, role) }]);
            onClose();
            return;
          }
          // What was attached is no longer to be chosen; the refused one and those after it stay chosen.
          const done = new Set(result.attached.map((policy) => policy.arn));
          setChosen((current) => current.filter((policy) => !done.has(policy.arn)));
          setRefusal({
            header: `${result.failed.policy.name} was not attached.`,
            failure: result.failed.failure,
            before: result.attached.length,
          });
        },
        onError: (error) => {
          setRefusal({ header: 'The policies were not attached.', failure: failureOf(error), before: 0 });
        },
      },
    );
  };

  return (
    <AreaModal
      visible
      size="large"
      header={`Attach policies to ${role}`}
      closeAriaLabel="Close dialog"
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={pending} onClick={handleDismiss}>
              Cancel
            </Button>
            <Button variant="primary" loading={pending} loadingText="Attaching" onClick={handleAttach}>
              Attach
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <PolicyChoiceTable
          connection={connection}
          chosen={chosen}
          onChoose={handleChoose}
          attached={attached}
          variant="embedded"
          label="Policies to attach"
          header={(count) => (
            <Header variant="h3" counter={`(${String(count)} selected)`}>
              Policies
            </Header>
          )}
        />
        {nothingChosen && <Alert type="error">{NOTHING_CHOSEN}</Alert>}
        {refusal !== undefined && <RefusalAlert refusal={refusal} engineOrigin={engineOrigin} />}
      </SpaceBetween>
    </AreaModal>
  );
}
