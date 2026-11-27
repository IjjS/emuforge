import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useRef, useState, type ReactNode } from 'react';

import { AreaModal } from '../../../components/area-modal';
import { optional } from '../../../components/choice-select';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem } from '../../../components/failure-states';
import type { KmsKeyChoice } from '../../../components/kms-key-choices';
import { usePageFlash } from '../../../components/page-flash';
import type { SecurityGroupChoice } from '../../../components/security-group-choices';
import { TagsField, type TagsFieldRef } from '../../../components/tags-field';
import { useAvailabilityZones } from '../../../components/use-availability-zones';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import { checkTagRows, type TagRow } from '../../../lib/tag-rows';
import type { SubnetGroupChoice } from '../choices-api';
import { useSubnetGroupPlacement } from '../choices-queries';
import { SNAPSHOT_OPERATIONS, type SnapshotRestore } from '../cluster-snapshot-api';
import { useClusterSnapshotActions } from '../cluster-snapshot-queries';
import { IDENTIFIER_CONSTRAINT, identifierError } from '../form';
import { CLUSTER_SNAPSHOTS_PATH } from '../format';
import { DeletionProtectionField, KeyField, ZonesField } from './choice-fields';
import { SecurityGroupsField, SubnetGroupField } from './create-fields';

interface DialogProps {
  target: string;
  pending: boolean;
  onDismiss: () => void;
}

interface SnapshotDraft {
  identifier: string;
  rows: readonly TagRow[];
}

export interface RestoreSnapshotDraft extends SnapshotDraft {
  subnetGroup: SubnetGroupChoice | undefined;
  groups: readonly SecurityGroupChoice[];
  zones: readonly string[];
  key: KmsKeyChoice | undefined;
  deletionProtection: boolean;
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
  initial,
  description,
  waitingForPlacement = false,
  children,
}: DialogProps & {
  onSubmit: (draft: SnapshotDraft, tags: readonly TagRow[]) => void;
  action: string;
  header: string;
  label: string;
  targetLabel: string;
  initial: SnapshotDraft | undefined;
  description?: string;
  waitingForPlacement?: boolean;
  children?: ReactNode;
}) {
  const [identifier, setIdentifier] = useState(initial?.identifier ?? '');
  const [rows, setRows] = useState(initial?.rows ?? []);
  const [edited, setEdited] = useState(false);
  const [tried, setTried] = useState(false);
  const tagsRef = useRef<TagsFieldRef>(null);
  const error = identifierError(identifier);
  const tags = checkTagRows(rows);

  const handleSubmit = () => {
    if (pending || error !== undefined || waitingForPlacement) return;
    setTried(true);
    if (tags.firstInvalid !== undefined) {
      tagsRef.current?.focusKey(tags.firstInvalid);
      return;
    }
    onSubmit({ identifier, rows }, tags.tags);
  };

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
              disabled={error !== undefined || waitingForPlacement}
              onClick={handleSubmit}
            >
              {action}
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <div inert={pending}>
        <SpaceBetween size="m">
          <Box variant="p">
            {targetLabel} <ValueText kind="name" value={target} />
          </Box>
          <FormField
            label={label}
            description={description}
            constraintText={IDENTIFIER_CONSTRAINT}
            errorText={edited ? error : undefined}
          >
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
          {children}
          <TagsField ref={tagsRef} rows={rows} errors={tried ? tags.errors : undefined} onChange={setRows} />
        </SpaceBetween>
      </div>
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
  const [target, setTarget] = useState<{ id: string; draft: SnapshotDraft | undefined }>();
  const [retry, setRetry] = useState<{ sourceId: string; draft: SnapshotDraft }>();
  const [pending, setPending] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const inFlight = useRef(false);
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
  const { create } = useClusterSnapshotActions(endpoint);

  const handleSubmit = async (draft: SnapshotDraft, tags: readonly TagRow[]) => {
    if (target === undefined || inFlight.current || unavailable) return;
    const signal = pageSignal();
    inFlight.current = true;
    setPending(true);
    try {
      const createdId = await create(target.id, draft.identifier, tags, signal);
      if (!signal.aborted) {
        flash.handOver(CLUSTER_SNAPSHOTS_PATH, [
          { type: 'success', content: `Creating DB cluster snapshot ${createdId}` },
        ]);
      }
    } catch (error) {
      if (signal.aborted) return;
      const failure = failureOf(error, SNAPSHOT_OPERATIONS.create);
      const subject = `Create DB cluster snapshot ${draft.identifier}`;
      const item = actionFailureItem(failure, subject, endpoint);
      if (failure.kind === 'not-implemented') {
        setUnavailable(true);
      } else {
        setRetry({ sourceId: target.id, draft });
      }
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
            const draft = retry?.sourceId === sourceId ? retry.draft : undefined;
            if (draft !== undefined) setRetry(undefined);
            setTarget({ id: sourceId, draft });
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
          target={target.id}
          initial={target.draft}
          pending={pending}
          onDismiss={() => {
            setTarget(undefined);
          }}
          onSubmit={(draft, tags) => {
            void handleSubmit(draft, tags);
          }}
        />
      )}
    </>
  );
}

export function RestoreSnapshotDialog({
  connection,
  initial,
  onSubmit,
  ...dialog
}: DialogProps & {
  connection: AreaConnection;
  initial: RestoreSnapshotDraft | undefined;
  onSubmit: (draft: RestoreSnapshotDraft, values: SnapshotRestore) => void;
}) {
  const [subnetGroup, setSubnetGroup] = useState(initial?.subnetGroup);
  const [chosenGroups, setGroups] = useState(initial?.groups ?? []);
  const [chosenZones, setZones] = useState(initial?.zones ?? []);
  const [key, setKey] = useState(initial?.key);
  const [deletionProtection, setDeletionProtection] = useState(initial?.deletionProtection ?? false);
  const { engineOrigin } = connection;
  const placement = useSubnetGroupPlacement(engineOrigin, undefined, subnetGroup?.name ?? 'default', true);
  const zoneRead = useAvailabilityZones(engineOrigin);
  const groups = placement.loading
    ? chosenGroups
    : chosenGroups.filter((group) => placement.data != null && group.vpcId === placement.data);
  const zones = placement.loading ? chosenZones : chosenZones.filter((zone) => placement.zones?.includes(zone));
  if (groups.length !== chosenGroups.length) setGroups(groups);
  if (zones.length !== chosenZones.length) setZones(zones);

  return (
    <SnapshotIdentifierDialog
      {...dialog}
      initial={initial}
      action="Restore"
      header="Restore DB cluster from snapshot"
      label="DB cluster identifier"
      description="Restore creates a new DB cluster with this identifier."
      targetLabel="Source snapshot"
      waitingForPlacement={placement.loading && (groups.length > 0 || zones.length > 0)}
      onSubmit={(draft, tags) => {
        onSubmit(
          { ...draft, subnetGroup, groups, zones, key, deletionProtection },
          {
            identifier: draft.identifier,
            ...optional({
              subnetGroupName: subnetGroup?.name,
              securityGroupIds: groups.length > 0 ? groups.map((group) => group.id) : undefined,
              zones: zones.length > 0 ? zones : undefined,
              kmsKeyArn: key?.arn,
              deletionProtection: deletionProtection || undefined,
              tags: tags.length > 0 ? tags : undefined,
            }),
          },
        );
      }}
    >
      <SpaceBetween size="m">
        <SubnetGroupField connection={connection} mode="cluster" value={subnetGroup} onChange={setSubnetGroup} />
        <SecurityGroupsField connection={connection} placement={placement} value={groups} onChange={setGroups} />
        <ZonesField
          connection={connection}
          placement={placement}
          zoneRead={zoneRead}
          zones={placement.zones}
          value={zones}
          onChange={setZones}
        />
        <KeyField connection={connection} restore encrypted value={key} onChange={setKey} />
        <DeletionProtectionField cluster checked={deletionProtection} onChange={setDeletionProtection} />
      </SpaceBetween>
    </SnapshotIdentifierDialog>
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
