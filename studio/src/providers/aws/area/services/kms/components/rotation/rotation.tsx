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
import { actionFailureItem, Code, ReadFailure, readFailureState } from '../../../../components/failure-states';
import { creationDateText, NO_DATE } from '../../../../components/format-date';
import { usePageFlash, type FlashItem } from '../../../../components/page-flash';
import { failureOf, noEndpoint, usePageSignal, useTokenListing } from '../../../../components/use-token-listing';
import { ValueText } from '../../../../components/value-text';
import { connectionFailure } from '../../queries';
import {
  changeKeyRotation,
  getKeyRotationStatus,
  listKeyRotations,
  ROTATION_OPERATIONS,
  type RotationAction,
} from '../../rotation-api';
import { RotationHistory } from './rotation-history';

const successMessage = {
  enable: 'Automatic rotation enabled.',
  disable: 'Automatic rotation disabled.',
  rotate: 'On-demand rotation requested.',
};

interface RotationProps {
  connection: AreaConnection;
  keyId: string;
  keySpec?: KeyMetadata['KeySpec'];
}

let visits = 0;

function RotationVisit({ connection, keyId, keySpec }: RotationProps) {
  const { engineOrigin } = connection;
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
  const reasonId = useId();
  const [visit] = useState(() => (visits += 1));
  const [revision, setRevision] = useState(0);
  const [statusRetry, setStatusRetry] = useState(false);
  const [historyRetry, setHistoryRetry] = useState(false);
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
  });
  const statusFailure = status.isError
    ? failureOf(status.error, ROTATION_OPERATIONS.status)
    : statusRetry
      ? undefined
      : statusOffline;
  const historyFailure = history.failure ?? (historyRetry ? undefined : historyOffline);
  const enabled = status.data?.KeyRotationEnabled;
  const period = status.data?.RotationPeriodInDays;
  const nextDate = creationDateText(status.data?.NextRotationDate);
  const toggleAction = enabled === true ? 'disable' : 'enable';
  const offline = engineOrigin === undefined || statusOffline !== undefined;
  const toggleReason = unavailable[toggleAction] ? `${reasonId}-automatic` : undefined;
  const rotateReason = unavailable.rotate ? `${reasonId}-on-demand` : undefined;

  const handleAction = async (action: RotationAction) => {
    if (offline || engineOrigin === undefined || unavailable[action] || inFlight.current) return;
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
              (toggleReason !== undefined || rotateReason !== undefined) && (
                <SpaceBetween size="xxs">
                  {toggleReason !== undefined && (
                    <div id={toggleReason}>The emulator does not implement {ROTATION_OPERATIONS[toggleAction]}.</div>
                  )}
                  {rotateReason !== undefined && (
                    <div id={rotateReason}>The emulator does not implement {ROTATION_OPERATIONS.rotate}.</div>
                  )}
                </SpaceBetween>
              )
            }
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button
                  disabled={
                    pending !== toggleAction &&
                    (offline ||
                      pending !== undefined ||
                      enabled === undefined ||
                      statusFailure !== undefined ||
                      toggleReason !== undefined)
                  }
                  {...(toggleReason === undefined ? {} : { ariaDescribedby: toggleReason })}
                  loading={pending === toggleAction}
                  onClick={() => void handleAction(toggleAction)}
                >
                  {enabled === true ? 'Disable automatic rotation' : 'Enable automatic rotation'}
                </Button>
                <Button
                  disabled={pending !== 'rotate' && (offline || pending !== undefined || rotateReason !== undefined)}
                  {...(rotateReason === undefined ? {} : { ariaDescribedby: rotateReason })}
                  loading={pending === 'rotate'}
                  onClick={() => void handleAction('rotate')}
                >
                  Rotate now
                </Button>
              </SpaceBetween>
            }
          >
            Key rotation
          </Header>
        }
      >
        {statusFailure !== undefined ? (
          <ReadFailure
            state={readFailureState(statusFailure, connection, 'rotation settings')}
            onRetry={() => {
              setStatusRetry(true);
              void status.refetch();
            }}
          />
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

export function Rotation({ connection, keyId, keySpec }: RotationProps) {
  // The AWS area remounts the page on a target change. A health poll alone must not replace this visit.
  return (
    <RotationVisit
      key={JSON.stringify([connection.engineOrigin, keyId])}
      connection={connection}
      keyId={keyId}
      keySpec={keySpec}
    />
  );
}
