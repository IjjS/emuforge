import type { Target } from '@aws-sdk/client-eventbridge';
import Button from '@cloudscape-design/components/button';
import Box from '@cloudscape-design/components/box';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useEffect } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import { readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import { ValueText } from '../../../components/value-text';
import type { useRuleTargets } from '../queries';
import { targetView } from '../target-view';

function InputText({ text }: { text: string | undefined }) {
  return (
    <Box
      variant="pre"
      margin={{ top: 'n', bottom: 'n' }}
      nativeAttributes={{ style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }}
    >
      {text ?? '-'}
    </Box>
  );
}

function TargetInput({ target }: { target: Target }) {
  const { input } = targetView(target);
  return (
    <SpaceBetween size="xxs">
      <ValueText kind="fixed" value={input.label} />
      {input.label === 'Part of the event' && <ValueText kind="text" value={input.path} />}
      {input.label === 'Constant' && <InputText text={input.text} />}
      {input.label === 'Transformed' && (
        <KeyValuePairs
          items={[
            ...(input.paths && Object.keys(input.paths).length > 0
              ? [{ label: 'Input paths', value: <InputText text={JSON.stringify(input.paths, null, 2)} /> }]
              : []),
            { label: 'Input template', value: <InputText text={input.template} /> },
          ]}
        />
      )}
    </SpaceBetween>
  );
}

function TargetDetails({ target }: { target: Target }) {
  const { deadLetterArn, retryPolicy, roleArn, messageGroupId } = targetView(target);
  const items = [];
  if (deadLetterArn !== undefined) {
    items.push({ label: 'Dead-letter queue ARN', value: <ValueText kind="address" value={deadLetterArn} /> });
  }
  if (retryPolicy?.MaximumEventAgeInSeconds !== undefined) {
    items.push({
      label: 'Maximum event age (seconds)',
      value: <ValueText kind="fixed" value={String(retryPolicy.MaximumEventAgeInSeconds)} />,
    });
  }
  if (retryPolicy?.MaximumRetryAttempts !== undefined) {
    items.push({
      label: 'Maximum retry attempts',
      value: <ValueText kind="fixed" value={String(retryPolicy.MaximumRetryAttempts)} />,
    });
  }
  if (roleArn !== undefined) items.push({ label: 'Role ARN', value: <ValueText kind="address" value={roleArn} /> });
  if (messageGroupId !== undefined) {
    items.push({ label: 'Message group ID', value: <ValueText kind="name" value={messageGroupId} /> });
  }
  return items.length > 0 ? <KeyValuePairs items={items} /> : '-';
}

const columns: TableProps.ColumnDefinition<Target>[] = [
  {
    id: 'id',
    header: 'ID',
    isRowHeader: true,
    minWidth: '28ch',
    cell: ({ Id }) => <ValueText kind="name" value={Id} none="-" />,
  },
  { id: 'arn', header: 'ARN', minWidth: '32ch', cell: ({ Arn }) => <ValueText kind="address" value={Arn} none="-" /> },
  { id: 'input', header: 'Receives', cell: (target) => <TargetInput target={target} /> },
  { id: 'details', header: 'Details', cell: (target) => <TargetDetails target={target} /> },
];

interface TargetsTableProps {
  connection: AreaConnection;
  targets: ReturnType<typeof useRuleTargets>;
  removeDisabledReason?: string | undefined;
  onRemove: (id: string) => void;
}

export function TargetsTable({ connection, targets, removeDisabledReason, onRemove }: TargetsTableProps) {
  const [announcement, announce] = useAnnouncer();
  const failure = targets.failure && readFailureState(targets.failure, connection, 'targets');
  const message = failure?.firstText ?? '';

  useEffect(() => {
    announce(message);
  }, [announce, message]);

  const actions: TableProps.ColumnDefinition<Target> = {
    id: 'actions',
    header: 'Actions',
    cell: ({ Id }) =>
      Id === undefined ? (
        '-'
      ) : (
        <Button
          ariaLabel={`Remove target ${Id}`}
          disabled={removeDisabledReason !== undefined}
          disabledReason={removeDisabledReason}
          onClick={() => onRemove(Id)}
        >
          Remove
        </Button>
      ),
  };

  return (
    <>
      <Table
        header={<Header variant="h2">Targets</Header>}
        items={targets.value ?? []}
        trackBy="Id"
        columnDefinitions={[...columns, actions]}
        wrapLines
        loading={targets.loading}
        loadingText="Loading targets"
        empty={
          failure ? (
            <ReadFailure state={failure} onRetry={targets.refresh} />
          ) : (
            <Box textAlign="center" variant="strong">
              No targets
            </Box>
          )
        }
      />
      {announcement}
    </>
  );
}
