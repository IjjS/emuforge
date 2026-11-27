import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import Checkbox from '@cloudscape-design/components/checkbox';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { OPERATIONS } from '../api';
import type { UpgradeTarget } from '../choices-api';
import type { SecurityGroupChoice } from '../../../components/security-group-choices';
import { ChoiceSelect, optional } from '../../../components/choice-select';
import type { AreaConnection } from '../../../components/emulator-line';
import { failureOf } from '../../../components/use-token-listing';
import type { RequestFailure } from '../../../../../../lib/aws/request';
import { AreaModal } from '../../../components/area-modal';
import { ValueText } from '../../../components/value-text';
import { useOrderableRows, useSubnetGroup, type ChoiceRead } from '../choices-queries';
import { failoverTargetChoices, readFailoverTargets, useClusterSecurityGroups } from '../cluster-queries';
import { IDENTIFIER_CONSTRAINT, identifierError } from '../form';
import { afterParent, canSave, changes, draftField, editField } from '../modify-draft';
import { storageTypes } from '../orderable';
import { RDS_KEYS, useRdsRead } from '../queries';
import { FieldReadStatus, UpgradeVersionField } from './choice-fields';
import { SecurityGroupsField } from './create-fields';
import type { DbCluster } from '../cluster-api';
import {
  CLUSTER_ACTIONS,
  clusterActionReason,
  retentionDays,
  type ClusterAction,
  type ClusterChanges,
  type ClusterOperation,
} from '../cluster-operations';

const ACTIONS: readonly ClusterAction[] = ['stop', 'start', 'modify', 'failover'];

interface OperationControlsProps {
  cluster: DbCluster;
  connection: AreaConnection;
  pending: boolean;
  reading: boolean;
  unavailable: ReadonlySet<ClusterAction>;
  onSubmit: (id: string, action: ClusterOperation) => Promise<'retain-draft' | 'discard-draft'>;
}

type Dialog = { kind: 'modify' | 'failover'; cluster: DbCluster };
type DialogOperation = Extract<ClusterOperation, { kind: Dialog['kind'] }>;
type Drafts = { [Kind in Dialog['kind']]?: Extract<DialogOperation, { kind: Kind }> | undefined };

export function ClusterOperationControls({
  cluster,
  connection,
  pending,
  reading,
  unavailable,
  onSubmit,
}: OperationControlsProps) {
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
          connection={connection}
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
          connection={connection}
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
  connection: AreaConnection;
  pending: boolean;
  onDismiss: () => void;
}

function ModifyDialog({
  cluster,
  connection,
  draft,
  pending,
  onDismiss,
  onSave,
}: DialogProps & { draft: ClusterChanges | undefined; onSave: (changes: ClusterChanges) => void }) {
  const [identifier, setIdentifier] = useState(draft?.newIdentifier ?? cluster.id);
  const [version, setVersion] = useState(draft?.version);
  const [groups, setGroups] = useState<readonly SecurityGroupChoice[]>(() =>
    (draft?.securityGroupIds ?? cluster.securityGroups).map((id) => ({ id })),
  );
  const [storedType, setStoredType] = useState(() =>
    editField(draftField(cluster.storageType), draft?.storageType ?? cluster.storageType),
  );
  const [retention, setRetention] = useState(
    (draft?.backupRetentionPeriod ?? cluster.backupRetentionPeriod)?.toString() ?? '',
  );
  const [retentionEdited, setRetentionEdited] = useState(false);
  const [protection, setProtection] = useState(draft?.deletionProtection ?? cluster.deletionProtection);
  const endpoint = connection.engineOrigin;
  const engine = cluster.engine ?? '';
  const targetVersion = version?.version ?? cluster.engineVersion;
  const versionField = editField(draftField<UpgradeTarget | undefined>(undefined), version);
  const rows = useOrderableRows(endpoint, engine, targetVersion);
  const types =
    rows.data === undefined
      ? undefined
      : storageTypes(rows.data).filter(({ type }) => type === 'aurora' || type === 'aurora-iopt1');
  const storage = afterParent(
    storedType,
    versionField,
    types?.map(({ type }) => type),
    `Choose a storage type for ${targetVersion ?? ''}`,
  );
  const [seenRows, setSeenRows] = useState(rows.data);
  if (rows.data !== seenRows) {
    setSeenRows(rows.data);
    setStoredType(storage);
  }

  const placement = useSubnetGroup(endpoint, cluster.subnetGroup);
  const startGroups = useClusterSecurityGroups(endpoint, cluster.securityGroups);
  const selectedGroups = groups.map((group) => startGroups.value?.find(({ id }) => id === group.id) ?? group);
  const missingIds =
    startGroups.value === undefined
      ? undefined
      : new Set(cluster.securityGroups.filter((id) => !startGroups.value?.some((group) => group.id === id)));

  const days = retentionDays(retention);
  const error = retentionEdited && days === undefined ? 'Enter a whole number from 1 to 35.' : undefined;
  const invalidIdentifier = identifier !== cluster.id ? identifierError(identifier) : undefined;
  const fields = {
    newIdentifier: editField(draftField(cluster.id), identifier),
    version: versionField,
    securityGroupIds: editField(
      draftField<readonly string[]>(
        cluster.securityGroups,
        (left, right) => left.length === right.length && left.every((id) => right.includes(id)),
      ),
      groups.map(({ id }) => id),
    ),
    storageType: storage,
    backupRetentionPeriod: editField(draftField(cluster.backupRetentionPeriod), days),
    deletionProtection: editField(draftField(cluster.deletionProtection), protection),
  };
  const patch = changes(fields);
  const changesToSend: ClusterChanges = optional(patch);

  return (
    <OperationDialog
      header="Modify DB cluster"
      id={cluster.id}
      pending={pending}
      onDismiss={onDismiss}
      submitLabel="Save changes"
      pendingLabel="Saving changes"
      canSubmit={
        error === undefined && invalidIdentifier === undefined && canSave(fields, rows.data, ['version', 'storageType'])
      }
      onSubmit={() => {
        onSave(changesToSend);
      }}
    >
      <SpaceBetween size="m">
        <FormField label="DB cluster identifier" constraintText={IDENTIFIER_CONSTRAINT} errorText={invalidIdentifier}>
          <Input value={identifier} disabled={pending} onChange={({ detail }) => setIdentifier(detail.value)} />
        </FormField>
        {cluster.engineVersion !== undefined && (
          <UpgradeVersionField
            connection={connection}
            engine={engine}
            version={cluster.engineVersion}
            value={version}
            onChange={setVersion}
          />
        )}
        <SecurityGroupsField
          connection={connection}
          value={selectedGroups}
          onChange={setGroups}
          placement={{ data: placement.data?.vpcId, failure: placement.failure, retry: placement.retry }}
          missingIds={missingIds}
          required
        />
        <FieldReadStatus
          connection={connection}
          thing="security groups"
          failure={startGroups.failure}
          retry={startGroups.refresh}
        />
        <ClusterStorageType
          connection={connection}
          pending={pending}
          rows={rows}
          types={types ?? []}
          value={storage}
          onChange={(value) => setStoredType(editField(storage, value))}
        />
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

function ClusterStorageType({
  connection,
  pending,
  rows,
  types,
  value,
  onChange,
}: {
  connection: AreaConnection;
  pending: boolean;
  rows: ChoiceRead<unknown>;
  types: ReturnType<typeof storageTypes>;
  value: ReturnType<typeof draftField<string | undefined>>;
  onChange: (value: string | undefined) => void;
}) {
  const options = types.map(({ type, minSize, maxSize }) => ({
    value: type,
    label: type,
    ...optional({
      description: minSize === undefined || maxSize === undefined ? undefined : `${minSize} to ${maxSize} GiB`,
    }),
  }));
  const unset = { value: '', label: 'Not set', description: 'The cluster has no storage type.' };
  const selected =
    value.value === undefined
      ? value.cleared === undefined
        ? unset
        : null
      : (options.find((option) => option.value === value.value) ?? {
          value: value.value,
          label: value.value,
          ...optional({ description: value.missing ? "Not in the emulator's list" : undefined }),
        });
  return (
    <FormField label="Storage type" errorText={value.cleared}>
      <SpaceBetween size="xs">
        <Select
          ariaLabel="Storage type"
          options={options}
          selectedOption={selected}
          triggerVariant="option"
          placeholder="Choose a storage type"
          disabled={pending || rows.data === undefined}
          invalid={value.cleared !== undefined}
          onChange={({ detail }) => onChange(detail.selectedOption.value)}
        />
        <FieldReadStatus
          connection={connection}
          thing="storage type"
          failure={rows.failure}
          loading={rows.loading}
          retry={rows.retry}
        />
      </SpaceBetween>
    </FormField>
  );
}

type FailoverTarget = Awaited<ReturnType<typeof readFailoverTargets>>[number];
type TargetRead = { targets?: FailoverTarget[]; failure?: RequestFailure; loading?: true };
const NO_READER = 'Failover requires a reader DB instance in this cluster.';

function FailoverDialog({
  cluster,
  connection,
  draft,
  pending,
  onDismiss,
  onFailover,
}: DialogProps & { draft: string | undefined; onFailover: (target: string) => void }) {
  const endpoint = connection.engineOrigin;
  const initial = useRdsRead({
    key: RDS_KEYS.choices('failover-targets', cluster.id, 'dialog'),
    endpoint,
    operation: OPERATIONS.describeDBInstances,
    read: (at, signal) => readFailoverTargets(at, cluster.id, signal),
  });
  const [latest, setLatest] = useState<TargetRead>();
  const [target, setTarget] = useState<FailoverTarget | undefined>(draft === undefined ? undefined : { id: draft });
  const targets = latest === undefined ? initial.value : latest.targets;
  const failure = latest === undefined ? initial.failure : latest.failure;
  const loading = latest === undefined ? initial.loading : latest.loading === true;
  const source = failoverTargetChoices(endpoint, cluster.id, async (at, id, signal) => {
    const pendingRead = { loading: true } as const;
    setLatest(pendingRead);
    try {
      const fresh = await readFailoverTargets(at, id, signal);
      signal.throwIfAborted();
      setLatest({ targets: fresh });
      return fresh;
    } catch (error) {
      if (signal.aborted) {
        setLatest((current) => (current === pendingRead ? undefined : current));
      } else {
        setLatest({ failure: failureOf(error, OPERATIONS.describeDBInstances) });
      }
      throw error;
    }
  });
  const selected = targets?.find(({ id }) => id === target?.id) ?? target;

  return (
    <OperationDialog
      header="Fail over DB cluster"
      id={cluster.id}
      pending={pending}
      onDismiss={onDismiss}
      submitLabel="Fail over"
      pendingLabel="Requesting failover"
      canSubmit={selected !== undefined && (targets?.length ?? 0) > 0}
      onSubmit={() => {
        if (selected !== undefined) onFailover(selected.id);
      }}
    >
      <FormField label="Target DB instance" description="The selected reader becomes the writer.">
        <SpaceBetween size="xs">
          <ChoiceSelect
            source={source}
            connection={connection}
            ariaLabel="Target DB instance"
            things="DB instances"
            placeholder="Select a reader DB instance"
            none="No reader DB instances"
            value={selected}
            onChange={setTarget}
          />
          {loading && <Box nativeAttributes={{ role: 'status' }}>Loading DB instances</Box>}
          {targets?.length === 0 && <Box variant="p">{NO_READER}</Box>}
          <FieldReadStatus
            connection={connection}
            thing="DB instances"
            failure={failure}
            retry={() => {
              setLatest(undefined);
              initial.refresh();
            }}
          />
        </SpaceBetween>
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
