import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import { useState } from 'react';

import { AreaModal } from '../../../components/area-modal';
import type { AreaConnection } from '../../../components/emulator-line';
import { Code, ReadFailure, readFailureState } from '../../../components/failure-states';
import { valueText } from '../format';
import type { FunctionAlias, FunctionVersion, ReleaseChange } from '../version-api';
import type { ReleaseReading, useReleaseMutation } from '../version-queries';

type ReleaseAction = ReleaseChange['operation'];

const ACTION_LABELS = {
  PublishVersion: 'Publish version',
  CreateAlias: 'Create alias',
  UpdateAlias: 'Edit alias',
  DeleteAlias: 'Delete alias',
} satisfies Record<ReleaseAction, string>;

type AliasDialog = { operation: 'CreateAlias' } | { operation: 'UpdateAlias' | 'DeleteAlias'; alias: FunctionAlias };

export interface VersionsTabProps {
  connection: AreaConnection;
  ready: boolean;
  versions: ReleaseReading<FunctionVersion>;
  aliases: ReleaseReading<FunctionAlias>;
  mutation: ReturnType<typeof useReleaseMutation>;
}

function CollectionFailure<T>({
  reading,
  connection,
  label,
}: {
  reading: ReleaseReading<T>;
  connection: AreaConnection;
  label: string;
}) {
  const failure = reading.failure;
  if (failure === undefined) {
    return null;
  }
  const state = readFailureState(failure, connection, label);
  return (
    <ReadFailure
      state={{
        ...state,
        detail:
          failure.kind === 'not-implemented' || failure.kind === 'access-denied' ? (
            state.detail
          ) : (
            <>
              <Code>{failure.operation}</Code> failed. {state.detail}
            </>
          ),
      }}
      onRetry={reading.refresh}
    />
  );
}

interface AliasDialogProps {
  dialog: AliasDialog;
  versions: readonly FunctionVersion[];
  pending: boolean;
  onDismiss: () => void;
  onSubmit: (change: ReleaseChange) => void;
}

function ManageAliasDialog({ dialog, versions, pending, onDismiss, onSubmit }: AliasDialogProps) {
  const { operation } = dialog;
  const creating = operation === 'CreateAlias';
  const deleting = operation === 'DeleteAlias';
  const [name, setName] = useState(creating ? '' : dialog.alias.name);
  const [version, setVersion] = useState(creating ? '' : dialog.alias.version);
  const [nameError, setNameError] = useState<string>();
  const options = versions.map(({ version }) => ({ label: version, value: version }));
  const selected = options.find(({ value }) => value === version) ?? null;
  const editingUnchanged = operation === 'UpdateAlias' && dialog.alias.version === version;

  const handleSubmit = () => {
    if (pending) {
      return;
    }
    if (deleting) {
      onSubmit({ operation, name });
      return;
    }
    if (selected === null || editingUnchanged) {
      return;
    }
    const trimmed = name.trim();
    if (creating && (!/^[a-zA-Z0-9_-]{1,128}$/.test(trimmed) || /^\d+$/.test(trimmed))) {
      setNameError('Enter 1–128 letters, numbers, hyphens, or underscores. The name cannot be all numbers.');
      return;
    }
    onSubmit({ operation, alias: { name: trimmed, version } });
  };

  return (
    <AreaModal
      visible
      header={ACTION_LABELS[operation]}
      closeAriaLabel="Close"
      onDismiss={onDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={pending} onClick={onDismiss}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!deleting && (selected === null || editingUnchanged)}
              loading={pending}
              onClick={handleSubmit}
            >
              {operation === 'UpdateAlias' ? 'Save changes' : ACTION_LABELS[operation]}
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      {deleting ? (
        <Box variant="p">
          Delete alias <Code>{name}</Code>? Version <Code>{version}</Code> will still be available.
        </Box>
      ) : (
        <SpaceBetween size="m">
          <FormField label="Alias name" errorText={nameError}>
            {creating ? (
              <Input
                value={name}
                disabled={pending}
                onChange={({ detail }) => {
                  setName(detail.value);
                  setNameError(undefined);
                }}
              />
            ) : (
              <Code>{name}</Code>
            )}
          </FormField>
          <FormField label="Target version">
            <Select
              options={options}
              selectedOption={selected}
              placeholder="Choose a published version"
              disabled={pending}
              onChange={({ detail }) => setVersion(detail.selectedOption.value ?? '')}
            />
          </FormField>
        </SpaceBetween>
      )}
    </AreaModal>
  );
}

export function VersionsTab({ connection, ready, versions, aliases, mutation }: VersionsTabProps) {
  const [dialog, setDialog] = useState<AliasDialog>();
  const published = (versions.items ?? []).filter(({ version }) => /^[1-9]\d*$/.test(version));
  const aliasPrerequisite =
    versions.items === undefined
      ? 'Published versions must be available to choose an alias target.'
      : 'Publish a version before creating an alias.';

  const reasonFor = (operation: ReleaseAction): string | undefined => {
    if (mutation.unsupported.has(operation)) {
      return `${operation}: Not implemented by the emulator`;
    }
    if (!ready) {
      return 'Wait until the function is ready.';
    }
    if ((operation === 'CreateAlias' || operation === 'UpdateAlias') && published.length === 0) {
      return aliasPrerequisite;
    }
    return undefined;
  };

  function handleChange(change: ReleaseChange) {
    if (reasonFor(change.operation) !== undefined || mutation.pending !== undefined) {
      return;
    }
    void mutation.submit(change).then((submitted) => {
      if (submitted) {
        setDialog(undefined);
      }
    });
  }

  return (
    <SpaceBetween size="l">
      <Table
        ariaLabels={{ tableLabel: 'Versions' }}
        trackBy="version"
        wrapLines
        header={
          <Header
            variant="h2"
            actions={
              <Button
                variant="primary"
                disabled={reasonFor('PublishVersion') !== undefined || mutation.pending !== undefined}
                disabledReason={reasonFor('PublishVersion')}
                loading={mutation.pending === 'PublishVersion'}
                onClick={() => handleChange({ operation: 'PublishVersion' })}
              >
                Publish version
              </Button>
            }
          >
            Versions
          </Header>
        }
        items={versions.items ?? []}
        loading={versions.loading}
        loadingText="Loading versions"
        empty={
          versions.failure === undefined ? (
            <Box textAlign="center">No versions returned.</Box>
          ) : (
            <CollectionFailure reading={versions} connection={connection} label="versions" />
          )
        }
        columnDefinitions={[
          { id: 'version', header: 'Version', cell: ({ version }) => <Code>{version}</Code> },
          {
            id: 'type',
            header: 'Type',
            cell: ({ version }) => (version === '$LATEST' ? 'Editable' : 'Published'),
          },
          { id: 'description', header: 'Description', cell: ({ description }) => valueText(description) },
        ]}
      />
      <Table
        ariaLabels={{ tableLabel: 'Aliases' }}
        trackBy="name"
        wrapLines
        header={
          <Header
            variant="h2"
            description={versions.items !== undefined && published.length === 0 ? aliasPrerequisite : undefined}
            actions={
              <Button
                disabled={reasonFor('CreateAlias') !== undefined || mutation.pending !== undefined}
                disabledReason={reasonFor('CreateAlias')}
                onClick={() => setDialog({ operation: 'CreateAlias' })}
              >
                Create alias
              </Button>
            }
          >
            Aliases
          </Header>
        }
        items={aliases.items ?? []}
        loading={aliases.loading}
        loadingText="Loading aliases"
        empty={
          aliases.failure === undefined ? (
            <Box textAlign="center">No aliases</Box>
          ) : (
            <CollectionFailure reading={aliases} connection={connection} label="aliases" />
          )
        }
        columnDefinitions={[
          { id: 'name', header: 'Alias name', cell: ({ name }) => <Code>{name}</Code> },
          { id: 'version', header: 'Target version', cell: ({ version }) => <Code>{version}</Code> },
          {
            id: 'actions',
            header: 'Actions',
            cell: (alias) => (
              <SpaceBetween direction="horizontal" size="xs">
                {(['UpdateAlias', 'DeleteAlias'] as const).map((operation) => (
                  <Button
                    key={operation}
                    variant="inline-link"
                    ariaLabel={`${ACTION_LABELS[operation]} ${alias.name}`}
                    disabled={reasonFor(operation) !== undefined || mutation.pending !== undefined}
                    disabledReason={reasonFor(operation)}
                    onClick={() => setDialog({ operation, alias })}
                  >
                    {operation === 'UpdateAlias' ? 'Edit' : 'Delete'}
                  </Button>
                ))}
              </SpaceBetween>
            ),
          },
        ]}
      />
      {dialog !== undefined && (
        <ManageAliasDialog
          dialog={dialog}
          versions={published}
          pending={mutation.pending !== undefined}
          onDismiss={() => {
            if (mutation.pending === undefined) {
              setDialog(undefined);
            }
          }}
          onSubmit={handleChange}
        />
      )}
    </SpaceBetween>
  );
}
