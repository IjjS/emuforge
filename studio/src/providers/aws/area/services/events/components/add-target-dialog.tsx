import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useRef, useState } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { AreaModal } from '../../../components/area-modal';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem } from '../../../components/failure-states';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { listRuleTargets, RULE_OPERATIONS } from '../rule-api';
import { putRuleTargets, PUT_TARGETS } from '../target-api';
import {
  buildTarget,
  emptyTarget,
  EXISTING_TARGET_ID,
  MAX_TARGETS,
  TARGET_LIMIT_TEXT,
  validateTarget,
  type TargetErrors,
  type TargetField,
} from '../target-form';
import { TargetFields, type TargetFieldsRef } from './target-fields';

interface AddTargetDialogProps {
  connection: AreaConnection & { engineOrigin: string };
  bus: string;
  name: string;
  operationUnavailable?: boolean;
  onAdded: (id: string) => void;
  onUnavailable: () => void;
  onDismiss: () => void;
}

export function AddTargetDialog({
  connection,
  bus,
  name,
  operationUnavailable,
  onAdded,
  onUnavailable,
  onDismiss,
}: AddTargetDialogProps) {
  const endpoint = connection.engineOrigin;
  const fields = useRef<TargetFieldsRef>(null);
  const pageSignal = usePageSignal();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState(emptyTarget);
  const [validated, setValidated] = useState(false);
  const [duplicate, setDuplicate] = useState<string>();
  const [full, setFull] = useState(false);
  const [localFailure, setFailure] = useState<RequestFailure>();
  const failure =
    localFailure ?? (operationUnavailable ? { kind: 'not-implemented', operation: PUT_TARGETS } : undefined);
  const unavailable = failure?.kind === 'not-implemented' && failure.operation === PUT_TARGETS;
  const errors: TargetErrors = validated ? validateTarget(draft) : {};
  if (duplicate === draft.id) errors.id = EXISTING_TARGET_ID;
  const item = failure && actionFailureItem(failure, failure.operation, endpoint);

  async function handleConfirm() {
    if (inFlight.current || unavailable) return;
    setValidated(true);
    setFailure(undefined);
    setDuplicate(undefined);
    setFull(false);
    const target = buildTarget(draft);
    if (target === undefined) {
      const [first] = Object.keys(validateTarget(draft)) as TargetField[];
      if (first !== undefined) fields.current?.focus(first);
      return;
    }

    inFlight.current = true;
    setPending(true);
    const signal = pageSignal();
    let operation: string = RULE_OPERATIONS.listTargetsByRule;
    try {
      const targets = await listRuleTargets(endpoint, bus, name, signal);
      if (signal.aborted) return;
      if (targets.some(({ Id }) => Id === draft.id)) {
        setDuplicate(draft.id);
        return;
      }
      if (targets.length >= MAX_TARGETS) {
        setFull(true);
        return;
      }
      operation = PUT_TARGETS;
      await putRuleTargets(endpoint, bus, name, [target], signal);
      if (!signal.aborted) onAdded(draft.id);
    } catch (error) {
      if (signal.aborted) return;
      const refusal = failureOf(error, operation);
      setFailure(refusal);
      if (operation === PUT_TARGETS && refusal.kind === 'not-implemented') onUnavailable();
    } finally {
      inFlight.current = false;
      if (!signal.aborted) setPending(false);
    }
  }

  function handleDismiss() {
    if (!inFlight.current) onDismiss();
  }

  return (
    <AreaModal
      visible
      header="Add target"
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
              loadingText="Adding target"
              onClick={() => void handleConfirm()}
            >
              Add target
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <TargetFields
          ref={fields}
          connection={connection}
          draft={draft}
          errors={errors}
          disabled={pending}
          onChange={setDraft}
        />
        {full && <Alert type="error">{TARGET_LIMIT_TEXT}</Alert>}
        {item && (
          <div role="alert">
            <Alert type={item.type} header={item.header}>
              {(failure?.kind === 'engine-did-not-answer' || failure?.kind === 'emulator-did-not-answer') &&
                `${failure.operation} failed. `}
              {item.content}
            </Alert>
          </div>
        )}
      </SpaceBetween>
    </AreaModal>
  );
}
