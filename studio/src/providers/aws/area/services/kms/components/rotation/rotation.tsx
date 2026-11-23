import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import type { AreaConnection } from '../../../../components/emulator-line';
import { actionFailureItem, ReadFailure, readFailureState } from '../../../../components/failure-states';
import { creationDateText } from '../../../../components/format-date';
import { usePageFlash } from '../../../../components/page-flash';
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
}

let visits = 0;

function RotationVisit({ connection, keyId }: RotationProps) {
  const { engineOrigin } = connection;
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
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
  const toggleAction = enabled === true ? 'disable' : 'enable';
  const busy = engineOrigin === undefined || statusOffline !== undefined || pending !== undefined;

  const handleAction = async (action: RotationAction) => {
    if (busy || engineOrigin === undefined || unavailable[action] || inFlight.current) return;
    inFlight.current = true;
    setPending(action);
    const signal = pageSignal();
    try {
      await changeKeyRotation(engineOrigin, keyId, action, signal);
      if (signal.aborted) return;
      flash.show([{ type: 'success', content: successMessage[action] }]);
      setRevision((current) => current + 1);
    } catch (error) {
      if (signal.aborted) return;
      const operation = ROTATION_OPERATIONS[action];
      const failure = failureOf(error, operation);
      if (failure.kind === 'not-implemented') setUnavailable((current) => ({ ...current, [action]: true }));
      flash.show([actionFailureItem(failure, operation, engineOrigin)]);
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
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button
                  disabled={
                    busy || enabled === undefined || statusFailure !== undefined || unavailable[toggleAction] === true
                  }
                  loading={pending === toggleAction}
                  onClick={() => void handleAction(toggleAction)}
                >
                  {enabled === true ? 'Disable automatic rotation' : 'Enable automatic rotation'}
                </Button>
                <Button
                  disabled={busy || unavailable.rotate === true}
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
                    '-'
                  ) : (
                    <StatusIndicator type={enabled ? 'success' : 'stopped'}>
                      {enabled ? 'Enabled' : 'Disabled'}
                    </StatusIndicator>
                  ),
              },
              {
                label: 'Rotation period',
                value: <ValueText kind="fixed" value={period === undefined ? '-' : `${period} days`} />,
              },
              {
                label: 'Next rotation date',
                value: <ValueText kind="fixed" value={creationDateText(status.data.NextRotationDate)} />,
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

export function Rotation({ connection, keyId }: RotationProps) {
  const connected = connection.result === undefined || connection.result.kind === 'connected';
  return (
    <RotationVisit
      key={JSON.stringify([connection.engineOrigin, keyId, connected])}
      connection={connection}
      keyId={keyId}
    />
  );
}
