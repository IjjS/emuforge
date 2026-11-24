import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import Checkbox from '@cloudscape-design/components/checkbox';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { AreaModal } from '../../../components/area-modal';
import { ValueText } from '../../../components/value-text';
import type { DbCluster } from '../cluster-api';
import {
  CLUSTER_ACTIONS,
  clusterActionReason,
  clusterReaders,
  retentionDays,
  type ClusterAction,
  type ClusterChanges,
  type ClusterOperation,
} from '../cluster-operations';

const ACTIONS: readonly ClusterAction[] = ['stop', 'start', 'modify', 'failover'];

interface OperationControlsProps {
  cluster: DbCluster;
  pending: boolean;
  reading: boolean;
  unavailable: ReadonlySet<ClusterAction>;
  onSubmit: (id: string, action: ClusterOperation) => Promise<'retain-draft' | 'discard-draft'>;
}

type Dialog = { kind: 'modify' | 'failover'; cluster: DbCluster };
type DialogOperation = Extract<ClusterOperation, { kind: Dialog['kind'] }>;
type Drafts = { [Kind in Dialog['kind']]?: Extract<DialogOperation, { kind: Kind }> | undefined };

export function ClusterOperationControls({ cluster, pending, reading, unavailable, onSubmit }: OperationControlsProps) {
  const [dialog, setDialog] = useState<Dialog>();
  const [drafts, setDrafts] = useState<Drafts>({});

  const reason = (action: ClusterAction) =>
    unavailable.has(action)
      ? `The emulator does not implement ${CLUSTER_ACTIONS[action].operation}.`
      : clusterActionReason(action, cluster);

  const handleDismiss = () => {
    if (dialog !== undefined) {
      setDrafts((current) => ({ ...current, [dialog.kind]: undefined }));
    }
    setDialog(undefined);
  };

  const handleSubmit = async (id: string, action: DialogOperation) => {
    const outcome = await onSubmit(id, action);
    setDrafts((current) => ({ ...current, [action.kind]: outcome === 'retain-draft' ? action : undefined }));
    setDialog(undefined);
  };

  return (
    <>
      <ButtonDropdown
        disabled={pending || reading}
        items={ACTIONS.map((action) => {
          const disabledReason = reason(action);
          return {
            id: action,
            text: CLUSTER_ACTIONS[action].label,
            ...(disabledReason === undefined ? {} : { disabled: true, disabledReason }),
          };
        })}
        onItemClick={({ detail }) => {
          const kind = ACTIONS.find((action) => action === detail.id);
          if (kind === undefined || pending || reading || reason(kind) !== undefined) return;
          if (kind === 'modify' || kind === 'failover') {
            setDialog({ kind, cluster });
          } else {
            void onSubmit(cluster.id, { kind });
          }
        }}
      >
        Actions
      </ButtonDropdown>
      {dialog?.kind === 'modify' && (
        <ModifyDialog
          cluster={dialog.cluster}
          draft={drafts.modify?.changes}
          pending={pending}
          onDismiss={handleDismiss}
          onSave={(changes) => {
            void handleSubmit(dialog.cluster.id, { kind: 'modify', changes });
          }}
        />
      )}
      {dialog?.kind === 'failover' && (
        <FailoverDialog
          cluster={dialog.cluster}
          draft={drafts.failover?.target}
          pending={pending}
          onDismiss={handleDismiss}
          onFailover={(target) => {
            void handleSubmit(dialog.cluster.id, { kind: 'failover', target });
          }}
        />
      )}
    </>
  );
}

interface DialogProps {
  cluster: DbCluster;
  pending: boolean;
  onDismiss: () => void;
}

function ModifyDialog({
  cluster,
  draft,
  pending,
  onDismiss,
  onSave,
}: DialogProps & { draft: ClusterChanges | undefined; onSave: (changes: ClusterChanges) => void }) {
  const [retention, setRetention] = useState(
    (draft?.backupRetentionPeriod ?? cluster.backupRetentionPeriod)?.toString() ?? '',
  );
  const [retentionEdited, setRetentionEdited] = useState(false);
  const [protection, setProtection] = useState(draft?.deletionProtection ?? cluster.deletionProtection);

  const days = retentionDays(retention);
  const error = retentionEdited && days === undefined ? 'Enter a whole number from 1 to 35.' : undefined;
  const changes: ClusterChanges = {};
  if (days !== undefined && days !== cluster.backupRetentionPeriod) changes.backupRetentionPeriod = days;
  if (protection !== cluster.deletionProtection) changes.deletionProtection = protection;

  return (
    <OperationDialog
      header="Modify DB cluster"
      id={cluster.id}
      pending={pending}
      onDismiss={onDismiss}
      submitLabel="Save changes"
      pendingLabel="Saving changes"
      canSubmit={error === undefined && Object.keys(changes).length > 0}
      onSubmit={() => {
        onSave(changes);
      }}
    >
      <SpaceBetween size="m">
        <Checkbox
          checked={protection}
          disabled={pending}
          onChange={({ detail }) => {
            setProtection(detail.checked);
          }}
        >
          Deletion protection
        </Checkbox>
        <FormField label="Backup retention period (days)" constraintText="1 to 35 days." errorText={error}>
          <Input
            value={retention}
            inputMode="numeric"
            invalid={error !== undefined}
            disabled={pending}
            onChange={({ detail }) => {
              setRetentionEdited(true);
              setRetention(detail.value);
            }}
          />
        </FormField>
      </SpaceBetween>
    </OperationDialog>
  );
}

function FailoverDialog({
  cluster,
  draft,
  pending,
  onDismiss,
  onFailover,
}: DialogProps & { draft: string | undefined; onFailover: (target: string) => void }) {
  const [target, setTarget] = useState(draft ?? '');
  const options = clusterReaders(cluster).map((id) => ({ label: id, value: id }));
  const selected = options.find(({ value }) => value === target);

  return (
    <OperationDialog
      header="Fail over DB cluster"
      id={cluster.id}
      pending={pending}
      onDismiss={onDismiss}
      submitLabel="Fail over"
      pendingLabel="Requesting failover"
      canSubmit={selected !== undefined}
      onSubmit={() => {
        onFailover(target);
      }}
    >
      <FormField label="Target DB instance" description="The selected reader becomes the writer.">
        <Select
          selectedOption={selected ?? null}
          options={options}
          placeholder="Select a reader DB instance"
          disabled={pending}
          onChange={({ detail }) => {
            setTarget(detail.selectedOption.value ?? '');
          }}
        />
      </FormField>
    </OperationDialog>
  );
}

function OperationDialog({
  header,
  id,
  pending,
  onDismiss,
  submitLabel,
  pendingLabel,
  canSubmit,
  onSubmit,
  children,
}: {
  header: string;
  id: string;
  pending: boolean;
  onDismiss: () => void;
  submitLabel: string;
  pendingLabel: string;
  canSubmit: boolean;
  onSubmit: () => void;
  children: ReactNode;
}) {
  const submitRef = useRef<ButtonProps.Ref>(null);
  useEffect(() => {
    if (pending) submitRef.current?.focus();
  }, [pending]);

  return (
    <AreaModal
      visible
      header={header}
      closeAriaLabel="Close"
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
              ref={submitRef}
              variant="primary"
              loading={pending}
              loadingText={pendingLabel}
              disabled={!pending && !canSubmit}
              onClick={() => {
                if (!pending && canSubmit) onSubmit();
              }}
            >
              {submitLabel}
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <Box variant="p">
          <ValueText kind="name" value={id} />
        </Box>
        {children}
      </SpaceBetween>
    </AreaModal>
  );
}
