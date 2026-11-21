import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';

import type { AreaConnection } from '../../../components/emulator-line';
import { NO_SUCH_BUCKET } from '../api';
import type { DestinationType } from '../notifications';
import type { NotificationChangeControl } from '../use-notification-change';
import { actionFailure } from './action-failure';
import { pageFailure } from './bucket-read';
import { BucketReadFailure } from './bucket-read-state';
import { NotificationTable } from './notification-table';

export function NotificationChangeStatus({
  change,
  connection,
  action,
  destination,
  onRefresh,
}: {
  change: NotificationChangeControl;
  connection: AreaConnection;
  action: 'Saving' | 'Deleting';
  destination?: DestinationType;
  onRefresh: () => void;
}) {
  const { state } = change;
  if (state.kind === 'pending') {
    return (
      <StatusIndicator type="loading">
        {action === 'Saving' ? 'Saving event notification' : 'Deleting event notification'}
      </StatusIndicator>
    );
  }
  if (state.kind === 'unconfirmed') {
    const observed = state.observed === NO_SUCH_BUCKET ? undefined : state.observed;
    const failure =
      state.failure === undefined
        ? undefined
        : actionFailure(state.failure, 'Reading event notifications', connection.engineOrigin);
    return (
      <SpaceBetween size="s">
        <Alert
          type="warning"
          header={
            failure === undefined
              ? 'The saved configuration differs from the requested change.'
              : 'Could not verify the saved configuration'
          }
          action={
            <Button formAction="none" onClick={change.checkAgain}>
              Check again
            </Button>
          }
        >
          {failure === undefined ? (
            state.observed === NO_SUCH_BUCKET ? (
              'The bucket was not found during verification.'
            ) : (
              'Review the configuration returned by the emulator.'
            )
          ) : (
            <>
              {failure.header}. {failure.detail}
            </>
          )}
        </Alert>
        {observed !== undefined && (
          <NotificationTable
            configuration={observed}
            header={() => (
              <Header
                variant="h2"
                description={
                  observed.EventBridgeConfiguration === undefined ? 'EventBridge disabled' : 'EventBridge enabled'
                }
              >
                Observed event notifications
              </Header>
            )}
          />
        )}
      </SpaceBetween>
    );
  }
  if (state.kind === 'failed') {
    if (state.stage === 'read' && state.failure.kind !== 'not-implemented') {
      return (
        <BucketReadFailure
          view={pageFailure(state.failure, connection, 'The event notifications could not be read')}
          onRetry={onRefresh}
        />
      );
    }
    const failure = actionFailure(state.failure, `${action} the event notification`, connection.engineOrigin);
    const validation = state.failure.kind === 'other' && state.failure.code === 'InvalidArgument';
    return (
      <Alert type={failure.type} header={failure.header}>
        <SpaceBetween size="xxs">
          {failure.detail}
          {validation &&
            destination === 'SQS queue' &&
            'Check that the queue policy allows S3 to send messages from this bucket'}
          {validation &&
            destination === 'Lambda function' &&
            'Check that the function allows S3 to invoke it from this bucket'}
        </SpaceBetween>
      </Alert>
    );
  }
  if (state.kind === 'missing' || state.kind === 'changed') {
    return (
      <Alert
        type="warning"
        action={
          <Button formAction="none" onClick={onRefresh}>
            Refresh event notifications
          </Button>
        }
      >
        {state.kind === 'missing'
          ? 'The bucket was not found.'
          : 'The notification changed after you opened it. Refresh event notifications to review the current rule.'}
      </Alert>
    );
  }
  if (state.kind === 'duplicate') return <Alert type="error">A notification with this name already exists.</Alert>;
  return null;
}
