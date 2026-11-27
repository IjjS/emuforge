import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import { useRef, useState } from 'react';

import { ConfirmNameDialog } from '../../../components/confirm-name-dialog';
import { actionFailureItem, CodeAndMessage } from '../../../components/failure-states';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import { DeleteAfterRemovalError, deleteRule, RemoveTargetsError, RULE_CHANGE_OPERATIONS } from '../rule-change-api';
import { RULE_OPERATIONS } from '../rule-api';

interface DeleteRuleDialogProps {
  endpoint: string;
  bus: string;
  name: string;
  targetCount: number;
  onDeleted: () => void;
  onTargetsChanged: () => void;
  onUnavailable: (operation: string) => void;
  onDismiss: () => void;
}

function targetCountText(count: number) {
  if (count === 0) return 'The rule is removed';
  if (count === 1) return 'The rule and its target are removed';
  return `The rule and its ${count} targets are removed`;
}

export function DeleteRuleDialog({
  endpoint,
  bus,
  name,
  targetCount,
  onDeleted,
  onTargetsChanged,
  onUnavailable,
  onDismiss,
}: DeleteRuleDialogProps) {
  const pageSignal = usePageSignal();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ cause: unknown }>();
  const failure = error && failureOf(error.cause, RULE_CHANGE_OPERATIONS.delete);
  const unavailable = failure?.kind === 'not-implemented' && failure.operation !== RULE_OPERATIONS.listTargetsByRule;
  const item = failure && actionFailureItem(failure, failure.operation, endpoint);
  const afterRemoval = error?.cause instanceof DeleteAfterRemovalError ? error.cause : undefined;
  const partialRemoval = error?.cause instanceof RemoveTargetsError ? error.cause : undefined;
  const feedback = item && (
    <div role="alert">
      <Alert type={item.type} header={item.header}>
        {afterRemoval && <Box variant="p">{afterRemoval.message}</Box>}
        {partialRemoval ? (
          <>
            <Box variant="p">{partialRemoval.message}</Box>
            {partialRemoval.entries.length > 0 && (
              <ul>
                {partialRemoval.entries.map(({ TargetId, ErrorCode, ErrorMessage }, index) => (
                  <li key={index}>
                    <ValueText kind="name" value={TargetId} none="Target ID unavailable" />{' '}
                    <CodeAndMessage code={ErrorCode ?? 'Failed entry'} message={ErrorMessage} />
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            {(failure.kind === 'engine-did-not-answer' || failure.kind === 'emulator-did-not-answer') &&
              `${failure.operation} failed. `}
            {item.content}
          </>
        )}
      </Alert>
    </div>
  );

  async function handleConfirm() {
    if (inFlight.current || unavailable) return;
    inFlight.current = true;
    setPending(true);
    setError(undefined);
    const signal = pageSignal();
    try {
      await deleteRule(endpoint, bus, name, signal);
    } catch (cause) {
      if (signal.aborted) return;
      const refusal = failureOf(cause, RULE_CHANGE_OPERATIONS.delete);
      setError({ cause });
      if (refusal.kind === 'not-implemented' && refusal.operation !== RULE_OPERATIONS.listTargetsByRule) {
        onUnavailable(refusal.operation);
      }
      if (cause instanceof RemoveTargetsError || cause instanceof DeleteAfterRemovalError) onTargetsChanged();
      inFlight.current = false;
      setPending(false);
      return;
    }
    if (!signal.aborted) onDeleted();
  }

  return (
    <ConfirmNameDialog
      visible
      header={
        <>
          Delete rule <ValueText kind="name" value={name} />?
        </>
      }
      body={`${targetCountText(targetCount)} from your local emulator. This cannot be undone.`}
      label="To confirm, type the rule's name."
      name={name}
      action="Delete rule"
      pending={pending}
      unavailable={unavailable ? feedback : undefined}
      feedback={unavailable ? undefined : feedback}
      onConfirm={() => void handleConfirm()}
      onDismiss={() => {
        if (!inFlight.current) onDismiss();
      }}
    />
  );
}
