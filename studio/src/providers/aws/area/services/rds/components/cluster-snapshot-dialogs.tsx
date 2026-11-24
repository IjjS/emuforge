import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useRef, useState } from 'react';

import { AreaModal } from '../../../components/area-modal';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { actionFailureItem } from '../../../components/failure-states';
import { usePageFlash } from '../../../components/page-flash';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import { SNAPSHOT_OPERATIONS } from '../cluster-snapshot-api';
import { useClusterSnapshotActions } from '../cluster-snapshot-queries';
import { IDENTIFIER_CONSTRAINT, identifierError } from '../form';
import { CLUSTER_SNAPSHOTS_PATH } from '../format';

interface DialogProps {
  target: string;
  pending: boolean;
  onDismiss: () => void;
}

interface IdentifierDialogProps extends DialogProps {
  onSubmit: (identifier: string) => void;
}

function SnapshotIdentifierDialog({
  target,
  pending,
  onDismiss,
  onSubmit,
  action,
  header,
  label,
  targetLabel,
}: IdentifierDialogProps & { action: string; header: string; label: string; targetLabel: string }) {
  const [identifier, setIdentifier] = useState('');
  const [edited, setEdited] = useState(false);
  const error = identifierError(identifier);

  return (
    <AreaModal
      visible
      header={header}
      closeAriaLabel="Close dialog"
      hideDismissButton={pending}
      onDismiss={() => {
        if (!pending) onDismiss();
      }}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={pending} onClick={onDismiss}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={pending}
              disabled={error !== undefined}
              onClick={() => {
                if (!pending && error === undefined) onSubmit(identifier);
              }}
            >
              {action}
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <Box variant="p">
          {targetLabel} <ValueText kind="name" value={target} />
        </Box>
        <FormField label={label} constraintText={IDENTIFIER_CONSTRAINT} errorText={edited ? error : undefined}>
          <Input
            value={identifier}
            invalid={edited && error !== undefined}
            disabled={pending}
            autoComplete={false}
            spellcheck={false}
            onChange={({ detail }) => {
              setEdited(true);
              setIdentifier(detail.value);
            }}
          />
        </FormField>
      </SpaceBetween>
    </AreaModal>
  );
}

export function TakeSnapshotAction({
  sourceId,
  disabled,
  endpoint,
}: {
  sourceId: string | undefined;
  disabled: boolean;
  endpoint: string | undefined;
}) {
  const [target, setTarget] = useState<string>();
  const [pending, setPending] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const inFlight = useRef(false);
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
  const { create } = useClusterSnapshotActions(endpoint);

  const handleSubmit = async (id: string) => {
    if (target === undefined || inFlight.current || unavailable) return;
    const signal = pageSignal();
    inFlight.current = true;
    setPending(true);
    try {
      const createdId = await create(target, id, signal);
      if (!signal.aborted) {
        flash.handOver(CLUSTER_SNAPSHOTS_PATH, [
          { type: 'success', content: `Creating DB cluster snapshot ${createdId}` },
        ]);
      }
    } catch (error) {
      if (signal.aborted) return;
      const failure = failureOf(error, SNAPSHOT_OPERATIONS.create);
      const subject = `Create DB cluster snapshot ${id}`;
      const item = actionFailureItem(failure, subject, endpoint);
      if (failure.kind === 'not-implemented') setUnavailable(true);
      flash.show([
        failure.kind === 'other' || failure.kind === 'not-implemented'
          ? item
          : {
              ...item,
              content: (
                <>
                  {subject}. {item.content}
                </>
              ),
            },
      ]);
    } finally {
      if (!signal.aborted) {
        inFlight.current = false;
        setPending(false);
        setTarget(undefined);
      }
    }
  };

  return (
    <>
      {sourceId !== undefined && (
        <Button
          disabled={disabled || pending || unavailable}
          onClick={() => {
            setTarget(sourceId);
          }}
        >
          Take snapshot
        </Button>
      )}
      {target !== undefined && (
        <SnapshotIdentifierDialog
          action="Take snapshot"
          header="Take DB cluster snapshot"
          label="DB cluster snapshot identifier"
          targetLabel="Source DB cluster"
          target={target}
          pending={pending}
          onDismiss={() => {
            setTarget(undefined);
          }}
          onSubmit={(id) => {
            void handleSubmit(id);
          }}
        />
      )}
    </>
  );
}

export function RestoreSnapshotDialog(props: IdentifierDialogProps) {
  return (
    <SnapshotIdentifierDialog
      {...props}
      action="Restore"
      header="Restore DB cluster from snapshot"
      label="DB cluster identifier"
      targetLabel="Source snapshot"
    />
  );
}

export function DeleteSnapshotDialog({
  target,
  pending,
  onDismiss,
  onConfirm,
}: DialogProps & { onConfirm: () => void }) {
  return (
    <ConfirmDialog
      visible
      header="Delete DB cluster snapshot?"
      body={`Delete ${target} from the local emulator. This cannot be undone.`}
      word="delete"
      action="Delete"
      pending={pending}
      onDismiss={onDismiss}
      onConfirm={onConfirm}
    />
  );
}
