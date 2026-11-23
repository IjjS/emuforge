import type { ReplicationStatusType } from '@aws-sdk/client-secrets-manager';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import { useState } from 'react';

import { CopyValue } from '../../../../components/copy-value';
import { ValueText } from '../../../../components/value-text';
import { REMOVE_REPLICA, REPLICATE_SECRET, removeReplica, replicateSecret } from '../../rotation-replication-api';
import { ChangeDialog, type ChangeDialogContext } from './change-dialog';

function AddReplicaDialog(context: ChangeDialogContext) {
  const [region, setRegion] = useState('');
  const [key, setKey] = useState('');
  const pending = context.action.pending !== undefined;
  return (
    <ChangeDialog
      {...context}
      operation={REPLICATE_SECRET}
      title="Add replica"
      submit="Add replica"
      result="Replication request accepted."
      valid={region.trim() !== ''}
      send={(endpoint, signal) =>
        replicateSecret(
          endpoint,
          context.name,
          { Region: region.trim(), ...(key.trim() !== '' && { KmsKeyId: key.trim() }) },
          signal,
        )
      }
    >
      <FormField label="Target Region">
        <Input value={region} onChange={({ detail }) => setRegion(detail.value)} disabled={pending} />
      </FormField>
      <FormField label="KMS key ARN (optional)" description="Use an existing local key in the target Region.">
        <Input value={key} onChange={({ detail }) => setKey(detail.value)} disabled={pending} />
      </FormField>
    </ChangeDialog>
  );
}

function RemoveReplicaDialog({ region, ...context }: ChangeDialogContext & { region: string }) {
  const [confirmation, setConfirmation] = useState('');
  const { name } = context;
  return (
    <ChangeDialog
      {...context}
      operation={REMOVE_REPLICA}
      title="Remove replica"
      submit="Remove replica"
      result="Replica removed."
      valid={confirmation === name}
      send={(endpoint, signal) => removeReplica(endpoint, name, region, signal)}
    >
      <Box>
        Remove the replica of {name} from {region}? This permanently deletes the replica and its data from that Region
        in your local emulator.
      </Box>
      <FormField label={`Type ${name} to confirm.`}>
        <Input
          value={confirmation}
          onChange={({ detail }) => setConfirmation(detail.value)}
          disabled={context.action.pending !== undefined}
        />
      </FormField>
    </ChangeDialog>
  );
}

type ReplicaEdit = { kind: 'add' } | { kind: 'remove'; region: string };

const promotionNote = (
  <Box color="text-body-secondary">Promotion requires a connection to the replica Region. Studio uses us-east-1.</Box>
);

function replicaStatus({ Status, StatusMessage }: ReplicationStatusType) {
  return (
    <SpaceBetween size="xxs">
      <ValueText kind="fixed" value={Status} />
      {StatusMessage && <ValueText kind="text" value={StatusMessage} />}
    </SpaceBetween>
  );
}

function replicaKey({ KmsKeyId }: ReplicationStatusType) {
  return <CopyValue label="Replica encryption key" value={KmsKeyId} none="-" />;
}

export function Replication({
  replicas,
  scheduled,
  compact,
  ...props
}: Omit<ChangeDialogContext, 'onClose'> & {
  replicas: ReplicationStatusType[];
  scheduled: boolean;
  compact: boolean;
}) {
  const { action } = props;
  const [edit, setEdit] = useState<ReplicaEdit>();
  const context = { ...props, onClose: () => setEdit(undefined) };
  const handleOpen = (target: ReplicaEdit) => {
    action.clearFailure();
    setEdit(target);
  };
  const blocked = (operation: string) => action.pending !== undefined || action.disabled(operation);
  const removeAction = ({ Region }: ReplicationStatusType) =>
    !scheduled &&
    Region && (
      <Button
        ariaLabel={`Remove replica in ${Region}`}
        disabled={blocked(REMOVE_REPLICA)}
        onClick={() => handleOpen({ kind: 'remove', region: Region })}
      >
        Remove
      </Button>
    );

  return (
    <>
      <Table
        variant="container"
        header={
          <Header
            variant="h2"
            actions={
              !scheduled && (
                <Button disabled={blocked(REPLICATE_SECRET)} onClick={() => handleOpen({ kind: 'add' })}>
                  Add
                </Button>
              )
            }
          >
            Regional replicas
          </Header>
        }
        items={replicas}
        trackBy="Region"
        wrapLines
        empty={<Box textAlign="center">This secret has no replicas.</Box>}
        columnDefinitions={
          compact
            ? [
                {
                  id: 'replica',
                  header: 'Replica',
                  cell: (replica) => (
                    <SpaceBetween size="xs">
                      <Box variant="strong">
                        <ValueText kind="fixed" value={replica.Region} />
                      </Box>
                      {replicaStatus(replica)}
                      {removeAction(replica)}
                      <Box>
                        <Box variant="small">Encryption key</Box>
                        {replicaKey(replica)}
                      </Box>
                      {promotionNote}
                    </SpaceBetween>
                  ),
                },
              ]
            : [
                {
                  id: 'region',
                  header: 'Region',
                  isRowHeader: true,
                  cell: ({ Region }) => <ValueText kind="fixed" value={Region} />,
                },
                { id: 'status', header: 'Status', cell: replicaStatus },
                { id: 'key', header: 'Encryption key', cell: replicaKey },
                {
                  id: 'actions',
                  header: 'Actions',
                  cell: (replica) => (
                    <SpaceBetween size="xxs">
                      {removeAction(replica)}
                      {promotionNote}
                    </SpaceBetween>
                  ),
                },
              ]
        }
      />
      {edit?.kind === 'add' && <AddReplicaDialog {...context} />}
      {edit?.kind === 'remove' && <RemoveReplicaDialog {...context} region={edit.region} />}
    </>
  );
}
