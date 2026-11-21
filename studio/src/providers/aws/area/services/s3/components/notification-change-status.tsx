import Alert from '@cloudscape-design/components/alert';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useEffect, useId, useRef } from 'react';

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
  showObserved = true,
  nextWrite,
  onViewCurrent,
  onRefresh,
}: {
  change: NotificationChangeControl;
  connection: AreaConnection;
  action: 'Saving' | 'Deleting';
  destination?: DestinationType;
  showObserved?: boolean;
  nextWrite?: { label: string; onClick: () => void };
  onViewCurrent?: () => void;
  onRefresh: () => void;
}) {
  const { state } = change;
  const messageId = useId();
  const headingId = useId();
  const verificationRef = useRef<HTMLDivElement>(null);
  const checkAgainRef = useRef<ButtonProps.Ref>(null);
  const verifying = state.kind === 'unconfirmed';
  const unavailable = verifying && state.failure?.kind === 'not-implemented';
  const retryEnabled = verifying && !change.checkAgainDisabled;
  const refusalRef = useRef<HTMLDivElement>(null);
  const sessionRefused =
    state.kind === 'failed' &&
    state.stage === 'write' &&
    state.failure.kind === 'other' &&
    state.failure.sessionRefused === true;
  useEffect(() => {
    if (sessionRefused) refusalRef.current?.focus();
  }, [sessionRefused]);

  useEffect(() => {
    if (!verifying) return;
    verificationRef.current?.scrollIntoView?.({ block: 'center' });
    if (unavailable) verificationRef.current?.focus();
    else if (retryEnabled) checkAgainRef.current?.focus();
  }, [verifying, unavailable, retryEnabled]);
  if (state.kind === 'pending') {
    return (
      <StatusIndicator type="loading">
        {state.checkingAgain
          ? 'Checking saved configuration'
          : action === 'Saving'
            ? 'Saving event notification'
            : 'Deleting event notification'}
      </StatusIndicator>
    );
  }
  if (state.kind === 'interrupted') {
    return (
      <Alert type="info" header="Notification change interrupted">
        The connection was interrupted before the write. Review the current configuration before trying again.
      </Alert>
    );
  }
  if (state.kind === 'unconfirmed') {
    const observed = !showObserved || state.observed === NO_SUCH_BUCKET ? undefined : state.observed;
    const failure =
      state.failure === undefined
        ? undefined
        : actionFailure(state.failure, 'Reading event notifications', connection.engineOrigin);
    return (
      <SpaceBetween size="s">
        <div
          ref={verificationRef}
          {...(unavailable
            ? { role: 'region', tabIndex: -1, 'aria-labelledby': headingId, 'aria-describedby': messageId }
            : {})}
        >
          <Alert
            type={unavailable ? 'info' : 'warning'}
            header={
              unavailable ? (
                <span id={headingId}>Not implemented by the emulator</span>
              ) : observed !== undefined ? (
                'The saved configuration differs from the requested change.'
              ) : (
                'Could not verify the saved configuration'
              )
            }
            action={
              <SpaceBetween size="xs" direction="horizontal">
                <Button
                  ref={checkAgainRef}
                  formAction="none"
                  ariaDescribedby={messageId}
                  disabled={change.checkAgainDisabled}
                  onClick={change.checkAgain}
                >
                  Check again
                </Button>
                {onViewCurrent !== undefined && retryEnabled && (
                  <Button formAction="none" onClick={onViewCurrent}>
                    View current configuration
                  </Button>
                )}
              </SpaceBetween>
            }
          >
            <div id={messageId}>
              <SpaceBetween size="xxs">
                {failure !== undefined && (
                  <div>
                    {!unavailable && <>{failure.header}. </>}
                    {failure.detail}
                  </div>
                )}
                {state.observed === NO_SUCH_BUCKET && 'The bucket was not found during verification.'}
                {!unavailable &&
                  (!retryEnabled
                    ? 'Verification can resume when the connection is restored.'
                    : observed === undefined
                      ? 'Select Check again to read the current configuration.'
                      : 'Review the configuration returned by the emulator.')}
              </SpaceBetween>
            </div>
          </Alert>
        </div>
        {observed !== undefined && (
          <NotificationTable
            configuration={observed}
            header={(_, overflows) => (
              <Header
                variant="h2"
                description={
                  <>
                    {observed.EventBridgeConfiguration === undefined ? 'EventBridge disabled.' : 'EventBridge enabled.'}
                    {overflows && ' Scroll sideways for event types and filters.'}
                  </>
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
    if (sessionRefused) {
      const reason = state.failure.kind === 'other' ? state.failure : undefined;
      return (
        <div ref={refusalRef} role="region" tabIndex={-1} aria-labelledby={headingId} aria-describedby={messageId}>
          <Alert
            type="error"
            header={<span id={headingId}>The engine refused the write before forwarding it</span>}
            action={
              nextWrite === undefined ? undefined : (
                <Button formAction="none" onClick={nextWrite.onClick}>
                  {nextWrite.label}
                </Button>
              )
            }
          >
            <div id={messageId}>
              <SpaceBetween size="xxs">
                <div>
                  Studio can renew the session when you{' '}
                  {action === 'Saving' ? 'submit again' : 'select Delete and confirm again'}.
                </div>
                <div>
                  Engine reason: {reason?.code}
                  {reason?.message === undefined ? '' : `: ${reason.message}`}
                </div>
              </SpaceBetween>
            </div>
          </Alert>
        </div>
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
