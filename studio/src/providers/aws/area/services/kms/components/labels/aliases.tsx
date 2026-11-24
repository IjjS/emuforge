import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type { AreaConnection } from '../../../../components/emulator-line';
import { useTokenListing } from '../../../../components/use-token-listing';
import { ValueText } from '../../../../components/value-text';
import { KMS_OPERATIONS, listKeyAliases } from '../../api';
import { createAlias, deleteAlias, LABEL_OPERATIONS, updateAlias } from '../../labels-api';
import { KMS_KEYS, useCustomerKeys } from '../../queries';
import { LabelActionError } from './label-action-error';
import {
  ConfirmLabelRemoval,
  LabelDialog,
  LabelListEmpty,
  LabelPagination,
  LabelReadAnnouncement,
  LabelRowActions,
  UnavailableActions,
} from './label-controls';
import { useLabelAction } from './use-label-action';

type AliasEdit = { kind: 'create' } | { kind: 'reassign' | 'delete'; alias: string };

export function Aliases({
  connection,
  keyId,
  writesEnabled,
}: {
  connection: AreaConnection;
  keyId: string;
  writesEnabled: boolean;
}) {
  const [edit, setEdit] = useState<AliasEdit>();
  const [name, setName] = useState('');
  const [targetId, setTargetId] = useState<string>();
  const [targetsOpened, setTargetsOpened] = useState(false);
  const [generation, setGeneration] = useState(0);
  const client = useQueryClient();
  const endpoint = connection.engineOrigin;
  const listing = useTokenListing({
    key: ['kms', 'aliases', keyId, generation],
    endpoint,
    operation: KMS_OPERATIONS.listAliases,
    read: (origin, marker, signal) => listKeyAliases(origin, keyId, marker, signal),
  });
  const targets = useCustomerKeys(endpoint, targetsOpened, 0);

  const action = useLabelAction(connection, writesEnabled, () => {
    setGeneration((current) => current + 1);
    void client.invalidateQueries({ queryKey: KMS_KEYS.list });
    void client.invalidateQueries({ queryKey: KMS_KEYS.detail(keyId) });
    if (targetId !== undefined) {
      void client.invalidateQueries({ queryKey: KMS_KEYS.detail(targetId) });
    }
  });

  const handleOpen = (next: AliasEdit) => {
    setName('');
    setTargetId(undefined);
    action.clearFailure();
    if (next.kind === 'reassign') {
      setTargetsOpened(true);
      targets.goToPage(1);
    }
    setEdit(next);
  };
  const handleClose = () => setEdit(undefined);
  const aliasName = name.startsWith('alias/') ? name : `alias/${name}`;
  const targetOptions = (targets.items ?? []).flatMap(({ id, description, aliases }) =>
    id === keyId ? [] : [{ label: id, value: id, ...(description ? { description } : {}), tags: aliases }],
  );

  return (
    <SpaceBetween size="s">
      <UnavailableActions operations={action.unavailable} />
      <Table
        trackBy={(alias) => alias}
        items={listing.items ?? []}
        wrapLines
        loading={listing.loading}
        loadingText="Loading aliases…"
        empty={<LabelListEmpty listing={listing} connection={connection} name="aliases" onRetry={listing.refresh} />}
        header={
          <>
            <LabelReadAnnouncement failure={listing.failure} connection={connection} name="aliases" />
            <Header
              variant="h2"
              actions={
                <Button
                  disabled={action.disabled(LABEL_OPERATIONS.createAlias)}
                  onClick={() => handleOpen({ kind: 'create' })}
                >
                  Create alias
                </Button>
              }
            >
              Aliases
            </Header>
          </>
        }
        pagination={<LabelPagination listing={listing} label="Alias pages" />}
        columnDefinitions={[
          {
            id: 'name',
            header: 'Alias name',
            minWidth: '24ch',
            isRowHeader: true,
            cell: (alias) => <ValueText kind="address" value={alias} />,
          },
          {
            id: 'actions',
            header: 'Actions',
            minWidth: 240,
            cell: (alias) => (
              <LabelRowActions>
                <Button
                  ariaLabel={`Reassign alias ${alias}`}
                  wrapText={false}
                  disabled={action.disabled(LABEL_OPERATIONS.updateAlias)}
                  onClick={() => handleOpen({ kind: 'reassign', alias })}
                >
                  Reassign
                </Button>
                <Button
                  ariaLabel={`Delete alias ${alias}`}
                  wrapText={false}
                  disabled={action.disabled(LABEL_OPERATIONS.deleteAlias)}
                  onClick={() => handleOpen({ kind: 'delete', alias })}
                >
                  Delete
                </Button>
              </LabelRowActions>
            ),
          },
        ]}
      />
      {edit?.kind === 'create' && (
        <LabelDialog
          title="Create alias"
          submit="Create alias"
          disabled={aliasName === 'alias/' || action.disabled(LABEL_OPERATIONS.createAlias)}
          pending={action.pending}
          onDismiss={handleClose}
          onSubmit={() => {
            void action.run(
              LABEL_OPERATIONS.createAlias,
              (origin, signal) => createAlias(origin, aliasName, keyId, signal),
              'Alias created.',
              handleClose,
            );
          }}
        >
          <LabelActionError failure={action.failure} />
          <FormField
            label="Alias name"
            description="Studio adds the alias/ prefix if you omit it."
            constraintText="Use letters, numbers, slashes (/), underscores (_), hyphens (-), or colons (:). The prefix alias/aws/ is reserved."
          >
            <Input value={name} disabled={action.pending} onChange={({ detail }) => setName(detail.value)} />
          </FormField>
        </LabelDialog>
      )}
      {edit?.kind === 'reassign' && (
        <LabelDialog
          title="Reassign alias"
          submit="Reassign alias"
          disabled={targetId === undefined || action.disabled(LABEL_OPERATIONS.updateAlias)}
          pending={action.pending}
          onDismiss={handleClose}
          onSubmit={() => {
            if (targetId === undefined) return;
            void action.run(
              LABEL_OPERATIONS.updateAlias,
              (origin, signal) => updateAlias(origin, edit.alias, targetId, signal),
              'Alias reassigned.',
              handleClose,
            );
          }}
        >
          <LabelActionError failure={action.failure} />
          <Box>
            Move <ValueText kind="address" value={edit.alias} /> to another customer managed key.
            <LabelReadAnnouncement failure={targets.failure} connection={connection} name="target keys" />
          </Box>
          <FormField label="Target key" description="Choose the key that should receive this alias.">
            <Select
              options={targetOptions}
              selectedOption={targetId === undefined ? null : { label: targetId, value: targetId }}
              placeholder="Choose a key"
              disabled={action.pending || targets.failure !== undefined}
              statusType={targets.loading ? 'loading' : 'finished'}
              loadingText="Loading customer managed keys…"
              empty="No other customer managed keys on this page"
              onChange={({ detail }) => setTargetId(detail.selectedOption.value)}
            />
          </FormField>
          {targets.failure !== undefined && (
            <LabelListEmpty listing={targets} connection={connection} name="target keys" onRetry={targets.refresh} />
          )}
          <LabelPagination listing={targets} label="Target key pages" />
        </LabelDialog>
      )}
      {edit?.kind === 'delete' && (
        <ConfirmLabelRemoval
          title="Delete alias"
          body={
            <>
              Delete <ValueText kind="address" value={edit.alias} /> from this key.
            </>
          }
          word="delete"
          disabled={action.disabled(LABEL_OPERATIONS.deleteAlias)}
          pending={action.pending}
          onDismiss={handleClose}
          onConfirm={() => {
            void action.run(
              LABEL_OPERATIONS.deleteAlias,
              (origin, signal) => deleteAlias(origin, edit.alias, signal),
              'Alias deleted.',
              handleClose,
              false,
            );
          }}
        />
      )}
    </SpaceBetween>
  );
}
