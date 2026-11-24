import type { KeyMetadata } from '@aws-sdk/client-kms';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useQuery } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';

import type { AreaConnection } from '../../../../components/emulator-line';
import { actionFailureItem, Code, ReadFailure } from '../../../../components/failure-states';
import { creationDateText, NO_DATE } from '../../../../components/format-date';
import { usePageFlash, type FlashItem } from '../../../../components/page-flash';
import { failureOf, noEndpoint, usePageSignal, useTokenListing } from '../../../../components/use-token-listing';
import { ValueText } from '../../../../components/value-text';
import { connectionFailure, readFailureState } from '../../queries';
import {
  changeKeyRotation,
  getKeyRotationStatus,
  listKeyRotations,
  ROTATION_OPERATIONS,
  type RotationAction,
} from '../../rotation-api';
import { RotationHistory } from './rotation-history';
import { useRotationRetryFocus } from './use-rotation-retry-focus';

const successMessage = {
  enable: 'Automatic rotation enabled.',
  disable: 'Automatic rotation disabled.',
  rotate: 'On-demand rotation requested.',
};

const automaticActionLabels = {
  enable: 'Enable automatic rotation',
  disable: 'Disable automatic rotation',
};

const HISTORY_FOLLOW_INTERVAL_MS = 500;
const HISTORY_FOLLOW_WINDOW_MS = 5_000;

interface RotationProps {
  connection: AreaConnection;
  keyId: string;
  keySpec?: KeyMetadata['KeySpec'];
  writesEnabled?: boolean;
}

let visits = 0;

function RotationVisit({ connection, keyId, keySpec, writesEnabled = true }: RotationProps) {
  const { engineOrigin } = connection;
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
  const { heading, retryRegion } = useRotationRetryFocus();
  const reasonId = useId();
  const [visit] = useState(() => (visits += 1));
  const [revision, setRevision] = useState(0);
  const [historyFollowUntil, setHistoryFollowUntil] = useState(0);
  const [statusRetry, setStatusRetry] = useState(false);
  const [historyRetry, setHistoryRetry] = useState(false);
  const [lastEnabled, setLastEnabled] = useState<boolean>();
  const [unavailable, setUnavailable] = useState<Partial<Record<RotationAction, true>>>({});
  const [pending, setPending] = useState<RotationAction>();
  const inFlight = useRef(false);
  const statusOffline = connectionFailure(connection, ROTATION_OPERATIONS.status);
  const historyOffline = connectionFailure(connection, ROTATION_OPERATIONS.history);
  const status = useQuery({
    queryKey: ['kms', 'rotation-status', engineOrigin, keyId, visit, revision],
    queryFn: ({ signal }) => getKeyRotationStatus(engineOrigin ?? noEndpoint(), keyId, signal),
    enabled: engineOrigin !== undefined && (statusOffline === undefined || statusRetry),
    retry: false,
    gcTime: 0,
  });
  const history = useTokenListing({
    key: ['kms', 'rotation-history', keyId, revision],
    endpoint: engineOrigin,
    operation: ROTATION_OPERATIONS.history,
    enabled: historyOffline === undefined || historyRetry,
    read: (endpoint, marker, signal) => listKeyRotations(endpoint, keyId, marker, signal),
    readAgainAfter: () =>
      historyOffline === undefined && Date.now() + HISTORY_FOLLOW_INTERVAL_MS <= historyFollowUntil
        ? HISTORY_FOLLOW_INTERVAL_MS
        : false,
  });
  const statusFailure = status.isError
    ? failureOf(status.error, ROTATION_OPERATIONS.status)
    : statusRetry
      ? undefined
      : statusOffline;
  const historyFailure = history.failure ?? (historyRetry ? undefined : historyOffline);
  const statusRecovery =
    statusFailure === undefined
      ? undefined
      : readFailureState(statusFailure, connection, `rotation settings (${statusFailure.operation})`);
  const enabled = status.data?.KeyRotationEnabled;
  // A failed refresh changes the read state, while the disabled toggle keeps its last confirmed action.
  if (status.isSuccess && enabled !== undefined && lastEnabled !== enabled) setLastEnabled(enabled);
  const period = status.data?.RotationPeriodInDays;
  const nextDate = creationDateText(status.data?.NextRotationDate);
  const toggleAction = (enabled ?? lastEnabled) === true ? 'disable' : 'enable';
  const writeBlocked = !writesEnabled || engineOrigin === undefined || statusOffline !== undefined;
  const automaticActions = (['enable', 'disable'] as const).filter(
    (action) => action === toggleAction || unavailable[action],
  );
  const unavailableActions = [...automaticActions, 'rotate' as const].filter((action) => unavailable[action]);
  const reasonFor = (action: RotationAction) => `${reasonId}-${action}`;

  const handleAction = async (action: RotationAction) => {
    if (writeBlocked || engineOrigin === undefined || unavailable[action] || inFlight.current) return;
    const initiatingFocus = document.activeElement;
    const showResult = (item: FlashItem) => {
      if (document.activeElement !== initiatingFocus) {
        flash.show([item]);
        return;
      }
      const result = (
        <span
          tabIndex={-1}
          ref={(element) => {
            if (element === null) return;
            const { activeElement, body } = element.ownerDocument;
            // A 501 can disable the focused button in the same commit that renders the result.
            if (activeElement !== initiatingFocus && activeElement !== body) return;
            element.focus({ preventScroll: true });
            element.scrollIntoView?.({ block: 'center', inline: 'nearest' });
          }}
        >
          {item.header ?? item.content}
        </span>
      );
      flash.show([item.header === undefined ? { ...item, content: result } : { ...item, header: result }]);
    };

    inFlight.current = true;
    setPending(action);
    const signal = pageSignal();
    try {
      await changeKeyRotation(engineOrigin, keyId, action, signal);
      if (signal.aborted) return;
      // Acknowledgment and the pending-status field can both precede the completed row in ListKeyRotations.
      if (action === 'rotate') setHistoryFollowUntil(Date.now() + HISTORY_FOLLOW_WINDOW_MS);
      showResult({ type: 'success', content: successMessage[action] });
      setRevision((current) => current + 1);
    } catch (error) {
      if (signal.aborted) return;
      const operation = ROTATION_OPERATIONS[action];
      const failure = failureOf(error, operation);
      if (failure.kind === 'not-implemented') setUnavailable((current) => ({ ...current, [action]: true }));
      const item = actionFailureItem(failure, operation, engineOrigin);
      if (failure.kind === 'other' && failure.code === 'UnsupportedOperationException' && keySpec !== undefined) {
        item.content = (
          <SpaceBetween size="xxs">
            <div>{item.content}</div>
            <div>
              The emulator does not support this rotation operation on this <Code>{keySpec}</Code> key.
            </div>
          </SpaceBetween>
        );
      }
      showResult(item);
    } finally {
      inFlight.current = false;
      if (!signal.aborted) setPending(undefined);
    }
  };

  return (
    <SpaceBetween size="l">
      <Container
        header={
          <Header
            variant="h2"
            description={
              unavailableActions.length > 0 && (
                <SpaceBetween size="xxs">
                  {unavailableActions.map((action) => (
                    <div key={action} id={reasonFor(action)}>
                      The emulator does not implement {ROTATION_OPERATIONS[action]}.
                    </div>
                  ))}
                </SpaceBetween>
              )
            }
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                {automaticActions.map((action) => (
                  <Button
                    key={action}
                    disabled={
                      pending !== action &&
                      (writeBlocked ||
                        pending !== undefined ||
                        enabled === undefined ||
                        statusFailure !== undefined ||
                        unavailable[action] === true)
                    }
                    {...(unavailable[action] ? { ariaDescribedby: reasonFor(action) } : {})}
                    loading={pending === action}
                    onClick={() => void handleAction(action)}
                  >
                    {automaticActionLabels[action]}
                  </Button>
                ))}
                <Button
                  disabled={
                    pending !== 'rotate' && (writeBlocked || pending !== undefined || unavailable.rotate === true)
                  }
                  {...(unavailable.rotate ? { ariaDescribedby: reasonFor('rotate') } : {})}
                  loading={pending === 'rotate'}
                  onClick={() => void handleAction('rotate')}
                >
                  Rotate now
                </Button>
              </SpaceBetween>
            }
          >
            <span ref={heading} tabIndex={-1}>
              Key rotation
            </span>
          </Header>
        }
      >
        <div className="aws-area-announcer" role="status" aria-label="Rotation settings read status" aria-atomic="true">
          {statusRecovery !== undefined && <span key={status.errorUpdateCount}>{statusRecovery.firstText}.</span>}
        </div>
        {statusRecovery !== undefined ? (
          <div ref={retryRegion}>
            <ReadFailure
              state={statusRecovery}
              onRetry={() => {
                setStatusRetry(true);
                void status.refetch();
              }}
            />
          </div>
        ) : status.data === undefined ? (
          <StatusIndicator type="loading">Loading rotation settings…</StatusIndicator>
        ) : (
          <KeyValuePairs
            columns={3}
            items={[
              {
                label: 'Automatic rotation',
                value:
                  enabled === undefined ? (
                    '–'
                  ) : (
                    <StatusIndicator type={enabled ? 'success' : 'stopped'}>
                      {enabled ? 'Enabled' : 'Disabled'}
                    </StatusIndicator>
                  ),
              },
              {
                label: 'Rotation period',
                value: <ValueText kind="fixed" value={period === undefined ? undefined : `${period} days`} none="–" />,
              },
              {
                label: 'Next rotation date',
                value: <ValueText kind="fixed" value={nextDate === NO_DATE ? undefined : nextDate} none="–" />,
              },
            ]}
          />
        )}
      </Container>
      <RotationHistory
        connection={connection}
        history={history}
        failure={historyFailure}
        onRetry={() => {
          setHistoryRetry(true);
          history.refresh();
        }}
      />
    </SpaceBetween>
  );
}

export function Rotation({ connection, keyId, keySpec, writesEnabled = true }: RotationProps) {
  // The AWS area remounts the page on a target change. A health poll alone must not replace this visit.
  return (
    <RotationVisit
      key={JSON.stringify([connection.engineOrigin, keyId])}
      connection={connection}
      keyId={keyId}
      keySpec={keySpec}
      writesEnabled={writesEnabled}
    />
  );
}
