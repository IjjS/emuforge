import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table from '@cloudscape-design/components/table';
import { useState } from 'react';

import { AreaModal } from '../../../components/area-modal';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem, readFailureState } from '../../../components/failure-states';
import { usePageFlash } from '../../../components/page-flash';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { EventSourceChange, EventSourceMapping } from '../event-source-api';
import type { useEventSources } from '../event-source-queries';
import { NONE } from '../format';

type Sources = ReturnType<typeof useEventSources>;
type Dialog = { kind: 'add' } | { kind: 'delete'; mapping: EventSourceMapping };

const ARN_HELP = 'Enter an SQS queue ARN, DynamoDB stream ARN, or Kinesis stream ARN.';
const ARN = /^arn:[a-z0-9-]+:(sqs|dynamodb|kinesis):[a-z0-9-]+:\d{12}:(\S+)$/;

function sourceType(value: string): 'queue' | 'stream' | undefined {
  const [, service, resource] = ARN.exec(value) ?? [];
  if (service === 'sqs' && /^[\w-]+(?:\.fifo)?$/.test(resource ?? '')) {
    return 'queue';
  }
  if (
    (service === 'dynamodb' && /^table\/[^/]+\/stream\/[^/]+$/.test(resource ?? '')) ||
    (service === 'kinesis' && /^stream\/[^/]+$/.test(resource ?? ''))
  ) {
    return 'stream';
  }
  return undefined;
}

function MappingDialog({
  dialog,
  name,
  pending,
  onDismiss,
  onSubmit,
}: {
  dialog: Dialog;
  name: string;
  pending: boolean;
  onDismiss: () => void;
  onSubmit: (change: EventSourceChange) => void;
}) {
  const [arn, setArn] = useState('');
  const [invalid, setInvalid] = useState(false);
  const source = sourceType(arn.trim());
  const deleting = dialog.kind === 'delete';
  const action = deleting ? 'Delete' : 'Add event source';

  function handleSubmit() {
    if (pending) {
      return;
    }
    if (dialog.kind === 'delete') {
      onSubmit({ operation: 'DeleteEventSourceMapping', mapping: dialog.mapping });
    } else if (source === undefined) {
      setInvalid(true);
    } else {
      onSubmit({
        operation: 'CreateEventSourceMapping',
        sourceArn: arn.trim(),
        ...(source === 'stream' ? { startingPosition: 'LATEST' } : {}),
      });
    }
  }

  return (
    <AreaModal
      visible
      header={deleting ? 'Delete event source mapping?' : action}
      closeAriaLabel="Close"
      onDismiss={() => {
        if (!pending) onDismiss();
      }}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={pending} onClick={onDismiss}>
              Cancel
            </Button>
            <Button variant="primary" loading={pending} onClick={handleSubmit}>
              {action}
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      {dialog.kind === 'delete' ? (
        <Box variant="p">
          Remove the mapping between <ValueText kind="address" value={dialog.mapping.sourceArn} none={NONE} /> and{' '}
          <ValueText kind="name" value={name} />? The function and event source will remain available.
        </Box>
      ) : (
        <SpaceBetween size="m">
          <FormField
            label="Event source ARN"
            description={ARN_HELP}
            errorText={invalid ? 'Use a supported event source ARN.' : undefined}
          >
            <Input
              value={arn}
              disabled={pending}
              onChange={({ detail }) => {
                setArn(detail.value);
                setInvalid(false);
              }}
              onKeyDown={({ detail }) => {
                if (detail.key === 'Enter') {
                  handleSubmit();
                }
              }}
            />
          </FormField>
          {source === 'stream' && (
            <FormField label="Starting position">
              <ValueText kind="fixed" value="LATEST" />
            </FormField>
          )}
        </SpaceBetween>
      )}
    </AreaModal>
  );
}

function ListFailure({
  failure,
  connection,
}: {
  failure: NonNullable<Sources['failure']>;
  connection: AreaConnection;
}) {
  const state = readFailureState(failure, connection, 'event sources');
  const follow = useFollow();
  return (
    <Box textAlign="center" color="inherit">
      <SpaceBetween size="xxs">
        <StatusIndicator type={state.type}>{state.first}</StatusIndicator>
        {state.detail !== undefined && <Box variant="p">{state.detail}</Box>}
        {state.recovery && (
          <Link href="/" onFollow={follow}>
            Connection status
          </Link>
        )}
      </SpaceBetween>
    </Box>
  );
}

const columns = [
  {
    id: 'source',
    header: 'Source ARN',
    cell: (item: EventSourceMapping) => <ValueText kind="address" value={item.sourceArn} none={NONE} />,
    isRowHeader: true,
  },
  {
    id: 'state',
    header: 'State',
    cell: (item: EventSourceMapping) => <ValueText kind="fixed" value={item.state} none={NONE} />,
  },
  {
    id: 'result',
    header: 'Last processing result',
    cell: (item: EventSourceMapping) => <ValueText kind="text" value={item.lastProcessingResult} none="Not reported" />,
  },
];

export function EventSourcesTab({
  name,
  sources,
  connection,
  ready,
}: {
  name: string;
  sources: Sources;
  connection: AreaConnection;
  ready: boolean;
}) {
  const flash = usePageFlash();
  const [selectedId, setSelectedId] = useState<string>();
  const [dialog, setDialog] = useState<Dialog>();
  const selected = sources.items.find(({ uuid }) => uuid === selectedId);
  const toEnable = selected?.state === 'Disabled';
  const canUpdate = toEnable || selected?.state === 'Enabled';
  const busy = !ready || sources.pending !== undefined;
  const updating = sources.pending === 'UpdateEventSourceMapping';

  async function handleSubmit(change: EventSourceChange) {
    const result = await sources.submit(change);
    if (result === undefined) {
      return;
    }
    setDialog(undefined);
    const { failure } = result;
    if (failure !== undefined) {
      const item = actionFailureItem(failure, failure.operation, connection.engineOrigin);
      const roleRefused =
        change.operation === 'CreateEventSourceMapping' &&
        failure.kind === 'other' &&
        failure.code === 'InvalidParameterValueException' &&
        (failure.message?.includes(
          'The function execution role does not have permissions to call ReceiveMessage on SQS',
        ) ||
          failure.message?.startsWith(`Cannot access stream ${change.sourceArn}. Please ensure the role can perform `));
      flash.show([
        roleRefused
          ? {
              ...item,
              content: (
                <SpaceBetween size="xs">
                  <div>{item.content}</div>
                  <div>Check the function execution role’s permissions for this source.</div>
                </SpaceBetween>
              ),
            }
          : item,
      ]);
      return;
    }
    const source = change.operation === 'CreateEventSourceMapping' ? change.sourceArn : change.mapping.sourceArn;
    let message = 'Added the event source mapping';
    if (change.operation === 'DeleteEventSourceMapping') {
      message = 'Requested deletion of the mapping';
    } else if (change.operation === 'UpdateEventSourceMapping') {
      message = change.enabled ? 'Requested enabling the mapping' : 'Requested disabling the mapping';
    }
    flash.show([
      {
        type: 'success',
        content: (
          <>
            {message} for <ValueText kind="address" value={source} none="the selected source" />.
          </>
        ),
      },
    ]);
  }

  const listFailure =
    sources.failure === undefined ? undefined : <ListFailure failure={sources.failure} connection={connection} />;
  return (
    <SpaceBetween size="m">
      {sources.items.length > 0 && listFailure}
      <Table
        ariaLabels={{
          tableLabel: 'Event sources',
          selectionGroupLabel: 'Event source selection',
          itemSelectionLabel: (_selection, { sourceArn, uuid }) => sourceArn ?? uuid,
        }}
        trackBy="uuid"
        selectionType="single"
        selectedItems={selected === undefined ? [] : [selected]}
        onSelectionChange={({ detail }) => setSelectedId(detail.selectedItems[0]?.uuid)}
        columnDefinitions={columns}
        items={sources.items}
        loading={sources.loading}
        loadingText="Loading event sources"
        wrapLines
        empty={listFailure ?? <Box textAlign="center">No event sources</Box>}
        header={
          <Header
            variant="h2"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button
                  iconName="refresh"
                  ariaLabel="Refresh"
                  disabled={sources.failure?.kind === 'not-implemented'}
                  loading={sources.refreshing}
                  loadingText="Refreshing event sources"
                  onClick={sources.refresh}
                />
                <Button
                  disabled={!updating && (busy || !canUpdate || sources.unsupported.has('UpdateEventSourceMapping'))}
                  loading={updating}
                  loadingText="Updating event source mapping"
                  onClick={() => {
                    if (selected !== undefined) {
                      void handleSubmit({
                        operation: 'UpdateEventSourceMapping',
                        mapping: selected,
                        enabled: toEnable,
                      });
                    }
                  }}
                >
                  {toEnable ? 'Enable' : 'Disable'}
                </Button>
                <Button
                  disabled={busy || selected === undefined || sources.unsupported.has('DeleteEventSourceMapping')}
                  onClick={() => {
                    if (selected !== undefined) {
                      setDialog({ kind: 'delete', mapping: selected });
                    }
                  }}
                >
                  Delete
                </Button>
                <Button
                  variant="primary"
                  disabled={busy || sources.unsupported.has('CreateEventSourceMapping')}
                  onClick={() => setDialog({ kind: 'add' })}
                >
                  Add event source
                </Button>
              </SpaceBetween>
            }
          >
            Event sources
          </Header>
        }
      />
      {dialog !== undefined && (
        <MappingDialog
          dialog={dialog}
          name={name}
          pending={sources.pending !== undefined}
          onDismiss={() => setDialog(undefined)}
          onSubmit={(change) => void handleSubmit(change)}
        />
      )}
    </SpaceBetween>
  );
}
