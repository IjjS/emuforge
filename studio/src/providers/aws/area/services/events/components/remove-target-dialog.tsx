import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useRef, useState } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { AreaModal } from '../../../components/area-modal';
import { actionFailureItem } from '../../../components/failure-states';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import { removeRuleTarget, RULE_CHANGE_OPERATIONS } from '../rule-change-api';

interface RemoveTargetDialogProps {
  endpoint: string;
  bus: string;
  name: string;
  id: string;
  onRemoved: () => void;
  onUnavailable: () => void;
  onDismiss: () => void;
}

export function RemoveTargetDialog({
  endpoint,
  bus,
  name,
  id,
  onRemoved,
  onUnavailable,
  onDismiss,
}: RemoveTargetDialogProps) {
  const pageSignal = usePageSignal();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<RequestFailure>();
  const operation = RULE_CHANGE_OPERATIONS.removeTargets;
  const unavailable = failure?.kind === 'not-implemented';
  const item = failure && actionFailureItem(failure, operation, endpoint);

  async function handleConfirm() {
    if (inFlight.current || unavailable) return;
    inFlight.current = true;
    setPending(true);
    setFailure(undefined);
    const signal = pageSignal();
    try {
      await removeRuleTarget(endpoint, bus, name, id, signal);
    } catch (error) {
      if (signal.aborted) return;
      const refusal = failureOf(error, operation);
      setFailure(refusal);
      if (refusal.kind === 'not-implemented') onUnavailable();
      inFlight.current = false;
      setPending(false);
      return;
    }
    if (!signal.aborted) onRemoved();
  }

  function handleDismiss() {
    if (!inFlight.current) onDismiss();
  }

  return (
    <AreaModal
      visible
      header={
        <>
          Remove target <ValueText kind="name" value={id} />?
        </>
      }
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
              disabled={unavailable}
              loading={pending}
              loadingText="Removing target"
              onClick={() => void handleConfirm()}
            >
              Remove
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <Box variant="p">The rule stops delivering to it. The resource it points at is not changed.</Box>
        {item && (
          <div role="alert">
            <Alert type={item.type} header={item.header}>
              {(failure?.kind === 'engine-did-not-answer' || failure?.kind === 'emulator-did-not-answer') &&
                `${operation} failed. `}
              {item.content}
            </Alert>
          </div>
        )}
      </SpaceBetween>
    </AreaModal>
  );
}
