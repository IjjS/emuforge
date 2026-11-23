import type { DescribeSecretCommandOutput } from '@aws-sdk/client-secrets-manager';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useState } from 'react';

import { CopyValue } from '../../../../components/copy-value';
import { creationDateText, NO_DATE } from '../../../../components/format-date';
import { CANCEL_ROTATE_SECRET, ROTATE_SECRET, cancelRotateSecret, rotateSecret } from '../../rotation-replication-api';
import { ChangeDialog, type ChangeDialogContext } from './change-dialog';

type RotationEdit = 'schedule' | 'rotate' | 'cancel';

function ScheduleDialog({ details, ...context }: ChangeDialogContext & { details: DescribeSecretCommandOutput }) {
  const [arn, setArn] = useState(details.RotationLambdaARN ?? '');
  const [days, setDays] = useState(String(details.RotationRules?.AutomaticallyAfterDays ?? ''));
  const interval = Number(days);
  const validInterval = /^\d+$/.test(days) && Number.isSafeInteger(interval) && interval > 0;
  const pending = context.action.pending !== undefined;
  return (
    <ChangeDialog
      {...context}
      operation={ROTATE_SECRET}
      title="Configure rotation"
      submit="Save schedule"
      result="Rotation schedule saved."
      valid={arn.trim() !== '' && validInterval}
      send={(endpoint, signal) =>
        rotateSecret(
          endpoint,
          {
            SecretId: context.name,
            RotationLambdaARN: arn.trim(),
            RotationRules: { AutomaticallyAfterDays: interval },
            RotateImmediately: false,
          },
          signal,
        )
      }
    >
      <FormField label="Rotation Lambda function ARN" description="Use an existing local Lambda function.">
        <Input value={arn} onChange={({ detail }) => setArn(detail.value)} disabled={pending} />
      </FormField>
      <FormField
        label="Rotation interval (days)"
        errorText={days !== '' && !validInterval ? 'Enter a positive whole number of days.' : undefined}
      >
        <Input type="number" value={days} onChange={({ detail }) => setDays(detail.value)} disabled={pending} />
      </FormField>
    </ChangeDialog>
  );
}

export function Rotation({
  details,
  scheduled,
  ...props
}: Omit<ChangeDialogContext, 'onClose'> & { details: DescribeSecretCommandOutput; scheduled: boolean }) {
  const { action, name } = props;
  const [edit, setEdit] = useState<RotationEdit>();
  const enabled = details.RotationEnabled === true;
  const interval = details.RotationRules?.AutomaticallyAfterDays;
  const nextDate = creationDateText(details.NextRotationDate);
  const context = { ...props, onClose: () => setEdit(undefined) };
  const handleOpen = (target: RotationEdit) => {
    action.clearFailure();
    setEdit(target);
  };

  const blocked = (operation: string) => action.pending !== undefined || action.disabled(operation);

  return (
    <Container
      header={
        <Header
          variant="h2"
          actions={
            !scheduled && (
              <SpaceBetween direction="horizontal" size="xs">
                <Button disabled={blocked(ROTATE_SECRET)} onClick={() => handleOpen('schedule')}>
                  Configure rotation
                </Button>
                <Button disabled={!enabled || blocked(ROTATE_SECRET)} onClick={() => handleOpen('rotate')}>
                  Rotate now
                </Button>
                <Button disabled={!enabled || blocked(CANCEL_ROTATE_SECRET)} onClick={() => handleOpen('cancel')}>
                  Cancel rotation
                </Button>
              </SpaceBetween>
            )
          }
        >
          Rotation
        </Header>
      }
    >
      <KeyValuePairs
        columns={2}
        items={[
          {
            type: 'group',
            items: [
              {
                label: 'Rotation status',
                value: (
                  <StatusIndicator type={enabled ? 'success' : 'stopped'}>
                    {enabled ? 'Enabled' : 'Disabled'}
                  </StatusIndicator>
                ),
              },
              { label: 'Next rotation date', value: nextDate === NO_DATE ? 'No next rotation date' : nextDate },
            ],
          },
          {
            type: 'group',
            items: [
              {
                label: 'Rotation Lambda function',
                value: <CopyValue label="Rotation Lambda function" value={details.RotationLambdaARN} none="-" />,
              },
              {
                label: 'Rotation interval',
                value:
                  interval === undefined
                    ? (details.RotationRules?.ScheduleExpression ?? '-')
                    : `${interval} ${interval === 1 ? 'day' : 'days'}`,
              },
            ],
          },
        ]}
      />
      {edit === 'schedule' && <ScheduleDialog {...context} details={details} />}
      {edit === 'rotate' && (
        <ChangeDialog
          {...context}
          operation={ROTATE_SECRET}
          title="Rotate now"
          submit="Request rotation"
          result="Rotation request accepted."
          send={(endpoint, signal) => rotateSecret(endpoint, { SecretId: name, RotateImmediately: true }, signal)}
        >
          <Box>Request immediate rotation for {name} in your local emulator?</Box>
        </ChangeDialog>
      )}
      {edit === 'cancel' && (
        <ChangeDialog
          {...context}
          operation={CANCEL_ROTATE_SECRET}
          title="Cancel rotation"
          submit="Cancel rotation"
          result="Rotation canceled."
          send={(endpoint, signal) => cancelRotateSecret(endpoint, name, signal)}
        >
          <Box>Cancel rotation for {name} in your local emulator?</Box>
        </ChangeDialog>
      )}
    </Container>
  );
}
