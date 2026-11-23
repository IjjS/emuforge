import type { DescribeSecretCommandOutput } from '@aws-sdk/client-secrets-manager';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import CopyToClipboard from '@cloudscape-design/components/copy-to-clipboard';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table from '@cloudscape-design/components/table';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { CopyValue } from '../../../components/copy-value';
import type { AreaConnection } from '../../../components/emulator-line';
import { ReadFailure, readFailureState } from '../../../components/failure-states';
import { usePageFlash } from '../../../components/page-flash';
import { creationDateText } from '../../../components/format-date';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { failureOf } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import { GET_SECRET_VALUE, getSecretValue } from '../api';
import { LifecycleDialog, type SecretEdit } from '../components/lifecycle/lifecycle-dialog';
import { useLifecycleAction } from '../components/lifecycle/use-lifecycle-action';
import { ResourcePolicy } from '../components/versions-policy/resource-policy';
import { VersionHistory } from '../components/versions-policy/version-history';
import {
  DELETE_SECRET,
  PUT_SECRET_VALUE,
  RESTORE_SECRET,
  TAG_RESOURCE,
  UNTAG_RESOURCE,
  UPDATE_SECRET,
} from '../lifecycle-api';
import { SECRETS_PATH, secretName } from '../paths';
import { useRefreshSecretReads, useSecretDetail } from '../queries';

type ValueState =
  | { kind: 'hidden' }
  | { kind: 'loading' }
  | { kind: 'shown'; format: 'String' | 'Base64'; text: string }
  | { kind: 'failure'; failure: RequestFailure };

function SecretValue({
  connection,
  endpoint,
  name,
  versionId,
  editAction,
  selectedVersion,
  unavailable,
  onUnavailable,
}: {
  connection: AreaConnection;
  endpoint: string;
  name: string;
  versionId?: string;
  editAction?: ReactNode;
  selectedVersion?: string;
  unavailable: boolean;
  onUnavailable: () => void;
}) {
  const [state, setState] = useState<ValueState>({ kind: 'hidden' });
  const request = useRef<AbortController | null>(null);
  useLayoutEffect(() => () => request.current?.abort(), []);

  const failure: RequestFailure | undefined = unavailable
    ? { kind: 'not-implemented', operation: GET_SECRET_VALUE }
    : state.kind === 'failure'
      ? state.failure
      : undefined;
  const error = failure === undefined ? undefined : readFailureState(failure, connection, 'secret value');
  const open = state.kind === 'loading' || state.kind === 'shown';

  const handleHide = () => {
    request.current?.abort();
    request.current = null;
    setState({ kind: 'hidden' });
  };

  const handleRetrieve = async () => {
    if (request.current !== null || failure?.kind === 'not-implemented') return;
    const controller = new AbortController();
    request.current = controller;
    setState({ kind: 'loading' });
    try {
      const result = await getSecretValue(endpoint, { SecretId: name, VersionId: versionId }, controller.signal);
      if (controller.signal.aborted) return;
      if (result.SecretString !== undefined) {
        setState({ kind: 'shown', format: 'String', text: result.SecretString });
      } else if (result.SecretBinary !== undefined) {
        setState({
          kind: 'shown',
          format: 'Base64',
          text: btoa(Array.from(result.SecretBinary, (byte) => String.fromCharCode(byte)).join('')),
        });
      } else {
        setState({
          kind: 'failure',
          failure: { kind: 'other', operation: GET_SECRET_VALUE, code: 'No secret value returned' },
        });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const failure = failureOf(error, GET_SECRET_VALUE);
        if (failure.kind === 'not-implemented') onUnavailable();
        setState({ kind: 'failure', failure });
      }
    } finally {
      if (request.current === controller) request.current = null;
    }
  };

  return (
    <Container
      header={
        <Header
          variant="h2"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                disabled={failure?.kind === 'not-implemented'}
                onClick={open ? handleHide : () => void handleRetrieve()}
              >
                {open ? 'Hide secret value' : 'Retrieve secret value'}
              </Button>
              {editAction}
            </SpaceBetween>
          }
        >
          Secret value
        </Header>
      }
    >
      <SpaceBetween size="s">
        {selectedVersion !== undefined && (
          <Box>
            Version <ValueText kind="name" value={selectedVersion} />
          </Box>
        )}
        {error !== undefined && (
          <Alert type={failure?.kind === 'not-implemented' ? 'info' : 'error'} header={error.first}>
            {error.detail}
          </Alert>
        )}
        {state.kind === 'loading' ? (
          <StatusIndicator type="loading">Retrieving secret value</StatusIndicator>
        ) : state.kind === 'shown' ? (
          <SpaceBetween size="xs">
            <Box variant="strong">{state.format}</Box>
            <Box nativeAttributes={{ style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }}>{state.text}</Box>
            <CopyToClipboard
              copyButtonText="Copy secret value"
              copyButtonAriaLabel="Copy secret value"
              copySuccessText="Secret value copied"
              copyErrorText="Secret value could not be copied"
              textToCopy={state.text}
              popoverRenderWithPortal={false}
            />
          </SpaceBetween>
        ) : (
          <Box color="text-body-secondary">Secret value is hidden.</Box>
        )}
      </SpaceBetween>
    </Container>
  );
}

function SecretMetadata({
  details,
  currentVersion,
  actions,
}: {
  details: DescribeSecretCommandOutput;
  currentVersion: string | undefined;
  actions?: ReactNode;
}) {
  const date = (value: Date | undefined) => <ValueText kind="fixed" value={creationDateText(value)} />;
  return (
    <Container
      header={
        <Header variant="h2" actions={actions}>
          Secret details
        </Header>
      }
    >
      <KeyValuePairs
        columns={2}
        items={[
          {
            type: 'group',
            items: [
              { label: 'ARN', value: <CopyValue label="ARN" value={details.ARN} none="-" /> },
              { label: 'Description', value: <ValueText kind="text" value={details.Description} none="-" /> },
              {
                label: 'Encryption key',
                value: <CopyValue label="Encryption key" value={details.KmsKeyId} none="-" />,
              },
              {
                label: 'Current version ID',
                value: <CopyValue label="Current version ID" kind="name" value={currentVersion} none="-" />,
              },
            ],
          },
          {
            type: 'group',
            items: [
              { label: 'Created', value: date(details.CreatedDate) },
              { label: 'Last changed', value: date(details.LastChangedDate) },
              { label: 'Last accessed', value: date(details.LastAccessedDate) },
              ...(details.DeletedDate === undefined
                ? []
                : [{ label: 'Scheduled deletion', value: date(details.DeletedDate) }]),
            ],
          },
        ]}
      />
    </Container>
  );
}

function SecretDetails({ connection, name }: { connection: AreaConnection; name: string }) {
  const handleFollow = useFollow();
  const flash = usePageFlash();
  const refreshReads = useRefreshSecretReads();
  const action = useLifecycleAction(connection);
  const [edit, setEdit] = useState<SecretEdit>();
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<string>();
  const [valueUnavailable, setValueUnavailable] = useState(false);
  const { details, failure, connectionFailure, loading, refresh } = useSecretDetail(connection, name);
  const readFailure = connectionFailure ?? failure;
  const unavailable = readFailure?.kind === 'not-implemented';
  const missing = name === '' || (readFailure?.kind === 'other' && readFailure.code === 'ResourceNotFoundException');
  const state = readFailure === undefined ? undefined : readFailureState(readFailure, connection, 'secret details');
  const currentVersion = Object.entries(details?.VersionIdsToStages ?? {}).find(([, stages]) =>
    stages.includes('AWSCURRENT'),
  )?.[0];
  const endpoint = connection.engineOrigin;
  const scheduled = details?.DeletedDate !== undefined;
  const editing = details !== undefined && readFailure === undefined ? edit : undefined;

  if (connectionFailure !== undefined) {
    if (edit !== undefined) setEdit(undefined);
    if (selectedVersion !== undefined) setSelectedVersion(undefined);
  }

  const handleSectionSaved = (section: 'versions' | 'policy', origin: string, content: string) => {
    flash.show([{ type: 'success', content }]);
    refreshReads(origin, name, section);
  };

  const editButton = (operation: string, edit: SecretEdit, label: string, ariaLabel?: string) => (
    <Button
      {...(ariaLabel !== undefined && { ariaLabel })}
      disabled={action.disabled(operation)}
      onClick={() => {
        action.clearFailure();
        setEdit(edit);
      }}
    >
      {label}
    </Button>
  );

  return (
    <SpaceBetween size="m">
      <Header
        variant="h1"
        actions={
          !missing && (
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                iconName="refresh"
                ariaLabel="Refresh"
                disabled={unavailable || loading || connectionFailure !== undefined}
                onClick={refresh}
              />
              {details !== undefined &&
                readFailure === undefined &&
                (scheduled
                  ? editButton(RESTORE_SECRET, { kind: 'restore' }, 'Restore secret')
                  : editButton(DELETE_SECRET, { kind: 'schedule' }, 'Schedule deletion'))}
              {details !== undefined &&
                readFailure === undefined &&
                editButton(DELETE_SECRET, { kind: 'permanent' }, 'Permanently delete')}
            </SpaceBetween>
          )
        }
      >
        <ValueText kind="name" value={name} none="Secret details" />
      </Header>
      {editing === undefined &&
        Array.from(action.unavailable, (operation) => (
          <Alert key={operation} type="info" header="Not implemented by the emulator">
            The emulator answered 501 Not Implemented for {operation}.
          </Alert>
        ))}
      {missing ? (
        <Alert type="error" header="Secret not found">
          <SpaceBetween size="xs">
            <Box>{name === '' ? 'Choose a secret from the list.' : `Your local emulator could not find ${name}.`}</Box>
            <Link href={SECRETS_PATH} onFollow={handleFollow}>
              Back to secrets
            </Link>
          </SpaceBetween>
        </Alert>
      ) : unavailable && state !== undefined ? (
        <Alert type="info" header={state.first} action={<Button disabled>Retry</Button>}>
          {state.detail}
        </Alert>
      ) : state !== undefined ? (
        <Container>
          <ReadFailure state={state} onRetry={refresh} />
        </Container>
      ) : details === undefined ? (
        <StatusIndicator type="loading">Loading secret details</StatusIndicator>
      ) : (
        <>
          <SecretMetadata
            details={details}
            currentVersion={currentVersion}
            actions={
              !scheduled && (
                <SpaceBetween direction="horizontal" size="xs">
                  {editButton(UPDATE_SECRET, { kind: 'description' }, 'Edit description')}
                  {editButton(UPDATE_SECRET, { kind: 'key' }, 'Change encryption key')}
                </SpaceBetween>
              )
            }
          />
          {endpoint !== undefined && (
            <>
              <VersionHistory
                key={endpoint}
                action={action}
                connection={connection}
                endpoint={endpoint}
                name={name}
                stagesByVersion={details.VersionIdsToStages}
                scheduled={scheduled}
                open={versionsOpen}
                selected={selectedVersion}
                onOpen={(open) => {
                  if (!open) setSelectedVersion(undefined);
                  setVersionsOpen(open);
                }}
                onSelect={setSelectedVersion}
                onSaved={(origin, message) => handleSectionSaved('versions', origin, message)}
              />
              <SecretValue
                key={JSON.stringify([
                  endpoint,
                  selectedVersion,
                  selectedVersion === undefined ? currentVersion : undefined,
                ])}
                endpoint={endpoint}
                name={name}
                versionId={selectedVersion}
                selectedVersion={selectedVersion}
                connection={connection}
                unavailable={valueUnavailable}
                onUnavailable={() => setValueUnavailable(true)}
                editAction={!scheduled && editButton(PUT_SECRET_VALUE, { kind: 'value' }, 'Edit secret value')}
              />
              <ResourcePolicy
                key={endpoint}
                action={action}
                connection={connection}
                endpoint={endpoint}
                name={name}
                open={policyOpen}
                scheduled={scheduled}
                onOpen={setPolicyOpen}
                onSaved={(origin, message) => handleSectionSaved('policy', origin, message)}
              />
            </>
          )}
          <Table
            variant="container"
            header={
              <Header variant="h2" actions={!scheduled && editButton(TAG_RESOURCE, { kind: 'add-tag' }, 'Add tag')}>
                Tags
              </Header>
            }
            columnDefinitions={[
              {
                id: 'key',
                header: 'Key',
                isRowHeader: true,
                minWidth: '24ch',
                cell: ({ Key }) => <ValueText kind="name" value={Key} />,
              },
              { id: 'value', header: 'Value', cell: ({ Value }) => <ValueText kind="text" value={Value} /> },
              ...(!scheduled
                ? [
                    {
                      id: 'actions',
                      header: 'Actions',
                      cell: ({ Key, Value }: NonNullable<DescribeSecretCommandOutput['Tags']>[number]) =>
                        Key && (
                          <SpaceBetween direction="horizontal" size="xs">
                            {editButton(
                              TAG_RESOURCE,
                              { kind: 'edit-tag', key: Key, value: Value ?? '' },
                              'Edit',
                              `Edit tag ${Key}`,
                            )}
                            {editButton(
                              UNTAG_RESOURCE,
                              { kind: 'remove-tag', key: Key },
                              'Remove',
                              `Remove tag ${Key}`,
                            )}
                          </SpaceBetween>
                        ),
                    },
                  ]
                : []),
            ]}
            items={details.Tags ?? []}
            trackBy="Key"
            empty={<Box textAlign="center">No tags</Box>}
            wrapLines
          />
        </>
      )}
      {editing !== undefined && details !== undefined && (
        <LifecycleDialog
          action={action}
          connection={connection}
          edit={editing}
          details={details}
          name={name}
          onClose={() => setEdit(undefined)}
          onSuccess={(origin, content) => {
            const result = [{ type: 'success', content }] as const;
            if (editing.kind === 'schedule' || editing.kind === 'permanent') flash.handOver(SECRETS_PATH, result);
            else flash.show(result);
            setEdit(undefined);
            refreshReads(origin, name, editing.kind === 'value' ? 'versions' : undefined);
          }}
        />
      )}
    </SpaceBetween>
  );
}

export function SecretPage({ connection }: { connection: AreaConnection }) {
  useShowsResources('secrets');
  const [query] = useSearchParams();
  const name = secretName(query);
  return <SecretDetails key={name} name={name} connection={connection} />;
}
