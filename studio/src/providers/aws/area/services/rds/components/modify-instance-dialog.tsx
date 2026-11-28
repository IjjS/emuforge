import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useEffect, useRef, useState } from 'react';

import { AreaModal } from '../../../components/area-modal';
import type { AreaConnection } from '../../../components/emulator-line';
import {
  DESCRIBE_SECURITY_GROUPS,
  readSecurityGroupsById,
  type SecurityGroupChoice,
} from '../../../components/security-group-choices';
import type { FlashItem } from '../../../components/page-flash';
import { withValues, type DbInstance } from '../api';
import type { SubnetGroupChoice, UpgradeTarget } from '../choices-api';
import { useOrderableRows, useSubnetGroupPlacement } from '../choices-queries';
import { useClusterOnce } from '../cluster-queries';
import {
  IDENTIFIER_CONSTRAINT,
  identifierError,
  iopsError,
  PASSWORD_CONSTRAINT,
  passwordError,
  requiresIops,
  storageError,
} from '../form';
import type { InstanceChanges } from '../modify-api';
import {
  afterParent,
  afterSubnetGroup,
  changed,
  changes,
  draftField,
  editField,
  editSecurityGroups,
  sameSecurityGroups,
} from '../modify-draft';
import { instanceClasses, type StorageTypeChoice } from '../orderable';
import { RDS_KEYS, useRdsRead } from '../queries';
import {
  DeletionProtectionField,
  InstanceClassField,
  IopsField,
  MultiAzField,
  StorageTypeField,
  UpgradeVersionField,
} from './choice-fields';
import { SecurityGroupsField, StorageField, SubnetGroupField } from './create-fields';

interface ModifyInstanceDialogProps {
  instance: DbInstance;
  connection: AreaConnection;
  pending: boolean;
  failure: FlashItem | undefined;
  onSave: (changes: InstanceChanges) => void;
  onDismiss: () => void;
}

function subnetChoice(group: DbInstance['subnetGroup']): SubnetGroupChoice | undefined {
  if (group === undefined) return undefined;
  return {
    name: group.name,
    ...(group.vpcId === undefined ? {} : { vpcId: group.vpcId }),
    ...(group.subnets.length === 0 ? {} : { hasSubnets: true }),
  };
}

function provisionedIopsError(value: string, storage: string, type: StorageTypeChoice | undefined) {
  const error = iopsError(value, storage, type);
  if (
    error !== undefined ||
    !requiresIops(type?.type) ||
    !/^\d+$/.test(storage) ||
    storageError(storage, type) === undefined
  )
    return error;
  // Check the ratio even when the size itself is outside the storage type's range.
  const size = Number(storage);
  const min = Math.ceil((type?.minIopsPerGib ?? 0) * size);
  const max = Math.floor((type?.maxIopsPerGib ?? Infinity) * size);
  if (Number(value) < min || Number(value) > max) {
    return Number.isFinite(max) ? `${min} to ${max} IOPS for ${size} GiB.` : `At least ${min} IOPS for ${size} GiB.`;
  }
  return undefined;
}

/** Mounted only while editing, so each opening starts with a fresh draft. */
export function ModifyInstanceDialog({
  instance,
  connection,
  pending,
  failure,
  onSave,
  onDismiss,
}: ModifyInstanceDialogProps) {
  const endpoint = connection.engineOrigin;
  const member = instance.clusterId !== undefined;
  const cluster = useClusterOnce(member ? endpoint : undefined, instance.clusterId ?? '');
  const clusterDetail = cluster.value?.found === true ? cluster.value.cluster : undefined;
  const engine = clusterDetail?.engine ?? instance.engine ?? '';

  const [identifier, setIdentifier] = useState(instance.id);
  const [version, setVersion] = useState(() => draftField<UpgradeTarget | undefined>(undefined));
  const orderableVersion = member ? clusterDetail?.engineVersion : (version.value?.version ?? instance.engineVersion);
  const rows = useOrderableRows(endpoint, engine, orderableVersion);
  const [instanceClass, setInstanceClass] = useState(() => draftField(instance.instanceClass));
  const [storageType, setStorageType] = useState(() => draftField(instance.storageType));
  const [storage, setStorage] = useState(instance.allocatedStorage?.toString() ?? '');
  const [iops, setIops] = useState(instance.iops?.toString() ?? '');
  const [password, setPassword] = useState('');
  const [multiAz, setMultiAz] = useState(instance.multiAz === true);
  const [protection, setProtection] = useState(instance.deletionProtection);
  const [subnetGroup, setSubnetGroup] = useState(() =>
    draftField(subnetChoice(instance.subnetGroup), (left, right) => left?.name === right?.name),
  );
  const [groups, setGroups] = useState(() =>
    draftField<readonly SecurityGroupChoice[]>(
      instance.securityGroups.map(({ id }) => ({ id })),
      sameSecurityGroups,
    ),
  );

  const groupIds = groups.start.map(({ id }) => id);
  const startingGroups = useRdsRead({
    key: RDS_KEYS.choices('current-instance-groups', ...groupIds),
    endpoint,
    operation: DESCRIBE_SECURITY_GROUPS,
    read: (at, signal) => readSecurityGroupsById(at, groupIds, signal),
    enabled: !member && groupIds.length > 0,
  });
  const placement = useSubnetGroupPlacement(member ? undefined : endpoint, subnetGroup.value, undefined, true);
  const subnetChanged = changed(subnetGroup);
  const groupsReady = groupIds.length === 0 || startingGroups.value !== undefined;
  const vpcId = placement.data ?? undefined;

  const knownGroups = new Map(startingGroups.value?.map((group) => [group.id, group]));
  const shownGroups = groups.value.map((group) => knownGroups.get(group.id) ?? group);
  const missingIds = new Set(startingGroups.value === undefined ? [] : groupIds.filter((id) => !knownGroups.has(id)));
  const [seenPlacement, setSeenPlacement] = useState<{
    subnet: typeof subnetGroup;
    vpcId: typeof vpcId;
    startingGroups: typeof startingGroups.value;
  }>();
  if (
    groupsReady &&
    (seenPlacement?.subnet !== subnetGroup ||
      seenPlacement.vpcId !== vpcId ||
      seenPlacement.startingGroups !== startingGroups.value)
  ) {
    setSeenPlacement({ subnet: subnetGroup, vpcId, startingGroups: startingGroups.value });
    setGroups(afterSubnetGroup({ ...groups, value: shownGroups }, subnetGroup, vpcId));
  }

  const classes = rows.data === undefined ? undefined : instanceClasses(rows.data);
  const [seenRows, setSeenRows] = useState<{
    rows: typeof rows.data;
    version: typeof version;
    instanceClass: typeof instanceClass;
  }>();
  const typeChoices = classes?.find(({ name }) => name === instanceClass.value)?.storageTypes ?? [];
  if (
    seenRows === undefined ||
    seenRows.rows !== rows.data ||
    seenRows.version !== version ||
    seenRows.instanceClass !== instanceClass
  ) {
    const nextClass = afterParent(
      instanceClass,
      version,
      classes?.map(({ name }) => name),
      `Choose a class for ${orderableVersion ?? ''}`,
    );
    setSeenRows({ rows: rows.data, version, instanceClass: nextClass });
    setInstanceClass(nextClass);
    if (!member && nextClass.cleared === undefined) {
      const types =
        classes === undefined ? undefined : (classes.find(({ name }) => name === nextClass.value)?.storageTypes ?? []);
      setStorageType(
        afterParent(
          storageType,
          nextClass,
          types?.map(({ type }) => type),
          `Choose a storage type for ${nextClass.value ?? 'the selected class'}`,
          changed(version),
        ),
      );
    }
  }

  const saveRef = useRef<ButtonProps.Ref>(null);
  const failureRef = useRef<AlertProps.Ref>(null);
  useEffect(() => {
    // Hiding Close changes the modal's autofocus target. Keep focus on the loading Save button.
    if (pending) saveRef.current?.focus();
    else if (failure !== undefined) failureRef.current?.focus();
  }, [pending, failure]);

  const renamed = identifier.toLowerCase() !== instance.id.toLowerCase();
  const type = typeChoices.find((choice) => choice.type === storageType.value);
  const shownType =
    instanceClass.cleared !== undefined
      ? undefined
      : (type ?? (storageType.value === undefined ? undefined : { type: storageType.value }));
  const typeChanged = changed(storageType);
  const sizeEdited = storage !== (instance.allocatedStorage?.toString() ?? '');
  const sizeChanged = sizeEdited && Number(storage) !== instance.allocatedStorage;
  const iopsChanged =
    requiresIops(storageType.value) && iops !== (instance.iops?.toString() ?? '') && Number(iops) !== instance.iops;
  const groupError =
    groups.cleared ??
    ((subnetChanged || changed(groups)) && groups.value.length === 0
      ? 'Choose at least one security group.'
      : undefined);
  const errors = {
    identifier: renamed ? identifierError(identifier) : undefined,
    instanceClass: instanceClass.cleared,
    storageType: instanceClass.value === undefined ? undefined : storageType.cleared,
    storage: !member && (sizeEdited || typeChanged) ? storageError(storage, shownType) : undefined,
    iops:
      !member && (sizeEdited || typeChanged || iopsChanged)
        ? provisionedIopsError(iops, storage, shownType)
        : undefined,
    password: member || password === '' ? undefined : passwordError(password),
    groups: groupError,
  };
  const edits = withValues<InstanceChanges>({}, changes({ instanceClass, storageType, engineVersion: version }));
  if (renamed && errors.identifier === undefined) edits.identifier = identifier;
  if (!member) {
    if (sizeChanged) edits.allocatedStorage = Number(storage);
    if (iopsChanged) edits.iops = Number(iops);
    if (password !== '') edits.masterPassword = password;
    if (multiAz !== (instance.multiAz === true)) edits.multiAz = multiAz;
    if (subnetChanged && subnetGroup.value !== undefined) edits.subnetGroup = subnetGroup.value.name;
    if (changed(groups)) edits.securityGroupIds = groups.value.map(({ id }) => id);
  }
  if (protection !== instance.deletionProtection) edits.deletionProtection = protection;

  const needsRows = changed(instanceClass) || changed(version) || typeChanged || sizeChanged || iopsChanged;
  const canSave =
    !pending &&
    Object.keys(edits).length > 0 &&
    Object.values(errors).every((error) => error === undefined) &&
    (!needsRows || rows.data !== undefined) &&
    (!(subnetChanged || changed(groups)) || (groupsReady && vpcId !== undefined));

  return (
    <AreaModal
      visible
      header="Modify DB instance"
      closeAriaLabel="Close"
      hideDismissButton={pending}
      onDismiss={() => {
        if (!pending) onDismiss();
      }}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button id="rds-modify-cancel" variant="link" disabled={pending} onClick={onDismiss}>
              Cancel
            </Button>
            <Button
              ref={saveRef}
              id="rds-modify-save"
              variant="primary"
              loading={pending}
              loadingText="Saving changes"
              disabled={!pending && !canSave}
              onClick={() => {
                if (canSave) onSave(edits);
              }}
            >
              Save changes
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <fieldset disabled={pending} style={{ border: 0, margin: 0, padding: 0, minInlineSize: 0 }}>
        <SpaceBetween size="m">
          {failure !== undefined && (
            <Alert ref={failureRef} type={failure.type} header={failure.header}>
              {failure.content}
            </Alert>
          )}
          <FormField
            id="rds-modify-field-identifier"
            label="DB instance identifier"
            description={
              edits.identifier === undefined
                ? undefined
                : 'After saving, the old identifier will stop resolving. Studio will open the renamed DB instance.'
            }
            constraintText={IDENTIFIER_CONSTRAINT}
            errorText={errors.identifier}
          >
            <Input
              value={identifier}
              invalid={errors.identifier !== undefined}
              autoComplete={false}
              spellcheck={false}
              onChange={({ detail }) => {
                setIdentifier(detail.value);
              }}
            />
          </FormField>
          {!member && instance.engineVersion !== undefined && (
            <UpgradeVersionField
              connection={connection}
              engine={engine}
              version={instance.engineVersion}
              value={version.value}
              onChange={(value) => setVersion(editField(version, value))}
            />
          )}
          <div id="rds-modify-field-class">
            <InstanceClassField
              connection={connection}
              engine={engine}
              version={orderableVersion}
              rows={rows}
              value={instanceClass.value}
              missing={instanceClass.missing}
              error={errors.instanceClass}
              defaultFailure={member ? cluster.failure : undefined}
              defaultLoading={member && cluster.loading}
              retryDefault={cluster.refresh}
              onChange={(value) => setInstanceClass(editField(instanceClass, value))}
            />
          </div>
          {member && (
            <Box id="rds-modify-cluster-guidance" variant="p">
              The cluster manages storage and master credentials.
            </Box>
          )}
          {!member && (
            <>
              <StorageTypeField
                connection={connection}
                mode="instance-modify"
                instanceClass={instanceClass.value}
                rows={rows}
                value={storageType.value}
                missing={storageType.missing}
                error={errors.storageType}
                onChange={(value) => setStorageType(editField(storageType, value))}
              />
              <div id="rds-modify-field-storage">
                <StorageField storageType={shownType} value={storage} error={errors.storage} onChange={setStorage} />
              </div>
              <IopsField storageType={shownType} value={iops} error={errors.iops} onChange={setIops} />
            </>
          )}
          {!member && (
            <FormField
              id="rds-modify-field-password"
              label="New master password"
              description="Leave blank to keep the current password."
              constraintText={PASSWORD_CONSTRAINT}
              errorText={errors.password}
            >
              <Input
                type="password"
                value={password}
                spellcheck={false}
                autoComplete="new-password"
                invalid={errors.password !== undefined}
                onChange={({ detail }) => {
                  setPassword(detail.value);
                }}
              />
            </FormField>
          )}
          {!member && (
            <>
              <MultiAzField checked={multiAz} onChange={setMultiAz} />
              <SubnetGroupField
                connection={connection}
                mode="modify"
                value={subnetGroup.value}
                onChange={(value) => setSubnetGroup(editField(subnetGroup, value))}
              />
              <SecurityGroupsField
                connection={connection}
                required
                value={shownGroups}
                missingIds={missingIds}
                error={errors.groups}
                placement={{
                  data: groupsReady ? placement.data : undefined,
                  loading: placement.loading || (!groupsReady && startingGroups.loading),
                  failure: startingGroups.failure ?? placement.failure,
                  retry: startingGroups.failure === undefined ? placement.retry : startingGroups.refresh,
                }}
                onChange={(value) => setGroups(editSecurityGroups(groups, value))}
              />
            </>
          )}
          <DeletionProtectionField checked={protection} onChange={setProtection} />
        </SpaceBetween>
      </fieldset>
    </AreaModal>
  );
}
