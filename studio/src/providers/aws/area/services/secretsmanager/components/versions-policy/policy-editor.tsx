import type { ValidateResourcePolicyCommandOutput } from '@aws-sdk/client-secrets-manager';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useState } from 'react';

import { AreaModal } from '../../../../components/area-modal';
import { DiscardDialog } from '../../../../components/discard-dialog';
import { DocumentField } from '../../../../components/document-field';
import type { AreaConnection } from '../../../../components/emulator-line';
import {
  PUT_RESOURCE_POLICY,
  putResourcePolicy,
  VALIDATE_RESOURCE_POLICY,
  validateResourcePolicy,
} from '../../versions-policy-api';
import { LifecycleFeedback } from '../lifecycle/lifecycle-feedback';
import type { LifecycleAction } from '../lifecycle/use-lifecycle-action';

export function PolicyEditor({
  action,
  connection,
  name,
  initial,
  onClose,
  onSaved,
}: {
  action: LifecycleAction;
  connection: AreaConnection;
  name: string;
  initial: string;
  onClose: () => void;
  onSaved: (origin: string) => void;
}) {
  const [document, setDocument] = useState(initial);
  const [validation, setValidation] = useState<{ document: string; result: ValidateResourcePolicyCommandOutput }>();
  const [discard, setDiscard] = useState(false);
  const pending = action.pending !== undefined;
  const passed = validation?.document === document && validation.result.PolicyValidationPassed === true;
  const canValidate = !pending && document.trim() !== '' && !action.disabled(VALIDATE_RESOURCE_POLICY);
  const canSave = passed && !pending && !action.disabled(PUT_RESOURCE_POLICY);

  const handleValidate = () => {
    if (!canValidate) return;
    setValidation(undefined);
    void action.run(
      VALIDATE_RESOURCE_POLICY,
      (endpoint, signal) => validateResourcePolicy(endpoint, name, document, signal),
      (result) => setValidation({ document, result }),
    );
  };

  const handleSave = () => {
    if (!canSave) return;
    void action.run(
      PUT_RESOURCE_POLICY,
      (endpoint, signal) => putResourcePolicy(endpoint, name, document, signal),
      (_, origin) => onSaved(origin),
    );
  };

  const handleDismiss = () => {
    if (pending) return;
    if (document !== initial) setDiscard(true);
    else onClose();
  };

  return (
    <>
      <AreaModal
        visible
        header="Edit resource policy"
        size="large"
        closeAriaLabel="Close dialog"
        onDismiss={handleDismiss}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" disabled={pending} onClick={handleDismiss}>
                Cancel
              </Button>
              <Button
                disabled={!canValidate}
                loading={action.pending === VALIDATE_RESOURCE_POLICY}
                onClick={handleValidate}
              >
                Validate policy
              </Button>
              <Button
                variant="primary"
                disabled={!canSave}
                loading={action.pending === PUT_RESOURCE_POLICY}
                onClick={handleSave}
              >
                Save policy
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <DocumentField
            label="Policy document"
            description="Validate the policy before saving."
            value={document}
            rows={12}
            disabled={pending}
            onChange={(text) => {
              setDocument(text);
              setValidation(undefined);
              action.clearFailure();
            }}
          />
          {validation !== undefined &&
            (passed ? (
              <StatusIndicator type="success">Policy validation passed.</StatusIndicator>
            ) : (
              <Alert type="error" header="Policy validation failed">
                <SpaceBetween size="xs">
                  {validation.result.ValidationErrors?.map(({ CheckName, ErrorMessage }, index) => (
                    <Box key={index}>{[CheckName, ErrorMessage].filter(Boolean).join(': ')}</Box>
                  ))}
                </SpaceBetween>
              </Alert>
            ))}
          <LifecycleFeedback action={action} connection={connection} what="Updating the resource policy" />
        </SpaceBetween>
      </AreaModal>
      {discard && (
        <DiscardDialog
          visible
          onAnswer={(answer) => {
            setDiscard(false);
            if (answer === 'discard') onClose();
          }}
        />
      )}
    </>
  );
}
