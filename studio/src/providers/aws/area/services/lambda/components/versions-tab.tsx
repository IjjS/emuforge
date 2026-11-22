import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';

import { AreaModal } from '../../../components/area-modal';
import type { AreaConnection } from '../../../components/emulator-line';
import { Code, ReadFailure, readFailureState } from '../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { ValueText } from '../../../components/value-text';
import { valueText } from '../format';
import type { FunctionAlias, FunctionVersion, ReleaseChange } from '../version-api';
import type { InlineReleaseRefusal, ReleaseReading, useReleaseMutation } from '../version-queries';

const NARROW_VIEWPORT = '(width < 688px)';
const ALIAS_NAME_MIN_WIDTH = '28ch';
const ALIAS_NAME_CONSTRAINT =
  'Use 1–128 letters (A–Z, a–z), numbers, hyphens, or underscores. The name cannot be all numbers.';

function subscribeToNarrowViewport(onChange: () => void) {
  const media = window.matchMedia?.(NARROW_VIEWPORT);
  media?.addEventListener('change', onChange);
  return () => media?.removeEventListener('change', onChange);
}

function isNarrowViewport() {
  return window.matchMedia?.(NARROW_VIEWPORT).matches ?? false;
}

type ReleaseAction = ReleaseChange['operation'];

const ACTION_LABELS = {
  PublishVersion: 'Publish version',
  CreateAlias: 'Create alias',
  UpdateAlias: 'Edit alias',
  DeleteAlias: 'Delete alias',
} satisfies Record<ReleaseAction, string>;

const ALIAS_ROW_ACTIONS = ['UpdateAlias', 'DeleteAlias'] as const;

type AliasDialog = { operation: 'CreateAlias' } | { operation: 'UpdateAlias' | 'DeleteAlias'; alias: FunctionAlias };

export interface VersionsTabProps {
  connection: AreaConnection;
  ready: boolean;
  versions: ReleaseReading<FunctionVersion>;
  aliases: ReleaseReading<FunctionAlias>;
  mutation: ReturnType<typeof useReleaseMutation>;
  /** Reports Delete alias openings and ordinary closings. The page classifies and clears a removed tab. */
  onAliasConfirmationChange?: (open: boolean) => void;
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
        detail: (
          <>
            {failure.kind !== 'not-implemented' && failure.kind !== 'access-denied' && (
              <>
                <Code>{failure.operation}</Code> failed.{' '}
              </>
            )}
            {failure.reportedCode !== undefined && (
              <>
                <Code>{failure.reportedCode}</Code>.{' '}
              </>
            )}
            {state.detail}
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
  onSubmit: (change: ReleaseChange, showInline: InlineReleaseRefusal) => Promise<void>;
}

function ManageAliasDialog({ dialog, versions, pending, onDismiss, onSubmit }: AliasDialogProps) {
  const { operation } = dialog;
  const creating = operation === 'CreateAlias';
  const deleting = operation === 'DeleteAlias';
  const [name, setName] = useState(creating ? '' : dialog.alias.name);
  const [version, setVersion] = useState(creating ? '' : dialog.alias.version);
  const [nameError, setNameError] = useState<string>();
  const [refusal, setRefusal] = useState<FlashItem>();
  const refusalRef = useRef<AlertProps.Ref>(null);
  const { show } = usePageFlash();
  const feedback = useRef<{ open: boolean; refusal: FlashItem | undefined }>({ open: false, refusal: undefined });
  useLayoutEffect(() => {
    const current = feedback.current;
    current.open = true;
    return () => {
      current.open = false;
      if (current.refusal !== undefined) {
        show([current.refusal]);
        current.refusal = undefined;
      }
    };
  }, [show]);
  useEffect(() => {
    if (refusal !== undefined) {
      refusalRef.current?.focus();
    }
  }, [refusal]);
  const options = versions.map(({ version }) => ({ label: version, value: version }));
  const selected = options.find(({ value }) => value === version) ?? null;
  const editingUnchanged = operation === 'UpdateAlias' && dialog.alias.version === version;

  const handleSubmit = () => {
    if (pending) {
      return;
    }
    if (!deleting && (selected === null || editingUnchanged)) {
      return;
    }
    const trimmed = name.trim();
    if (creating && (!/^[a-zA-Z0-9_-]{1,128}$/.test(trimmed) || /^\d+$/.test(trimmed))) {
      setNameError('Enter 1–128 letters, numbers, hyphens, or underscores. The name cannot be all numbers.');
      return;
    }
    const change = deleting ? { operation, name } : { operation, alias: { name: trimmed, version } };
    feedback.current.refusal = undefined;
    setRefusal(undefined);
    void onSubmit(change, (item) => {
      if (!feedback.current.open) {
        return false;
      }
      feedback.current.refusal = item;
      setRefusal(item);
      return true;
    });
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
      <SpaceBetween size="m">
        {refusal !== undefined && (
          <div role="alert">
            <Alert ref={refusalRef} type={refusal.type} header={refusal.header}>
              {refusal.content}
            </Alert>
          </div>
        )}
        {deleting ? (
          <Box variant="p">
            Delete alias <Code>{name}</Code>? Version <Code>{version}</Code> will still be available.
          </Box>
        ) : (
          <SpaceBetween size="m">
            <FormField
              label="Alias name"
              constraintText={creating ? ALIAS_NAME_CONSTRAINT : undefined}
              errorText={nameError}
            >
              {creating ? (
                <Input
                  value={name}
                  disabled={pending}
                  onChange={({ detail }) => {
                    setName(detail.value);
                    setNameError(undefined);
                    feedback.current.refusal = undefined;
                    setRefusal(undefined);
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
      </SpaceBetween>
    </AreaModal>
  );
}

export function VersionsTab({
  connection,
  ready,
  versions,
  aliases,
  mutation,
  onAliasConfirmationChange,
}: VersionsTabProps) {
  const [dialog, setDialog] = useState<AliasDialog>();
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const narrow = useSyncExternalStore(subscribeToNarrowViewport, isNarrowViewport);
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

  function closeDialog() {
    setDialog(undefined);
    if (dialog?.operation === 'DeleteAlias') {
      onAliasConfirmationChange?.(false);
    }
  }

  async function handleChange(change: ReleaseChange, showInline?: InlineReleaseRefusal): Promise<void> {
    if (reasonFor(change.operation) !== undefined || mutation.pending !== undefined) {
      return;
    }
    if ((await mutation.submit(change, showInline)) && mounted.current) {
      closeDialog();
    }
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
                onClick={() => {
                  void handleChange({ operation: 'PublishVersion' });
                }}
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
        columnDisplay={[
          { id: 'actions', visible: true },
          { id: 'name', visible: true },
          { id: 'version', visible: !narrow },
        ]}
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
          {
            id: 'actions',
            header: 'Actions',
            width: '76px',
            cell: (alias) => (
              <ButtonDropdown
                variant="icon"
                ariaLabel={`Actions for alias ${alias.name}`}
                disabled={mutation.pending !== undefined}
                items={ALIAS_ROW_ACTIONS.map((operation) => {
                  const reason = reasonFor(operation);
                  return {
                    id: operation,
                    text: ACTION_LABELS[operation],
                    ariaLabel: `${ACTION_LABELS[operation]} ${alias.name}`,
                    ...(reason === undefined ? {} : { disabled: true, disabledReason: reason }),
                  };
                })}
                onItemClick={({ detail }) => {
                  const operation = ALIAS_ROW_ACTIONS.find((action) => action === detail.id);
                  if (operation !== undefined) {
                    setDialog({ operation, alias });
                    if (operation === 'DeleteAlias') {
                      onAliasConfirmationChange?.(true);
                    }
                  }
                }}
              />
            ),
          },
          {
            id: 'name',
            header: 'Alias name',
            isRowHeader: true,
            ...(narrow ? {} : { minWidth: ALIAS_NAME_MIN_WIDTH }),
            cell: ({ name, version }) => (
              <>
                <ValueText kind="name" value={name} />
                {narrow && (
                  <Box variant="small" display="block">
                    Target version <Code>{version}</Code>
                  </Box>
                )}
              </>
            ),
          },
          { id: 'version', header: 'Target version', cell: ({ version }) => <Code>{version}</Code> },
        ]}
      />
      {dialog !== undefined && (
        <ManageAliasDialog
          dialog={dialog}
          versions={published}
          pending={mutation.pending !== undefined}
          onDismiss={() => {
            if (mutation.pending === undefined) {
              closeDialog();
            }
          }}
          onSubmit={handleChange}
        />
      )}
    </SpaceBetween>
  );
}
