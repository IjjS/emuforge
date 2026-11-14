import Box from '@cloudscape-design/components/box';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import LiveRegion from '@cloudscape-design/components/live-region';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator, { type StatusIndicatorProps } from '@cloudscape-design/components/status-indicator';
import { useEffect, useRef, type FocusEvent } from 'react';
import type { CheckResult } from '../../lib/engine/engine-client';
import { ConnectionAlert } from './connection-alerts';
import { formatCheckTime, hasAlert } from './connection-state';

/** One row of the container: a status and the address it is about; `endpoint` `undefined` shows "-". */
interface Row {
  type: StatusIndicatorProps.Type;
  label: string;
  endpoint: string | undefined;
}

const NOT_KNOWN: Row = { type: 'pending', label: 'Unknown', endpoint: undefined };

function rows(result: CheckResult | undefined, engineOrigin: string | undefined): { engine: Row; emulator: Row } {
  if (result === undefined) {
    return {
      engine: { type: 'loading', label: 'Checking', endpoint: engineOrigin },
      emulator: { type: 'loading', label: 'Checking', endpoint: undefined },
    };
  }
  const connected: Row = { type: 'success', label: 'Connected', endpoint: engineOrigin };
  switch (result.kind) {
    case 'connected':
      return { engine: connected, emulator: { ...connected, endpoint: result.emulator.endpoint } };
    case 'emulator-unreachable':
      return {
        engine: connected,
        emulator:
          result.reason === 'not_started'
            ? { type: 'stopped', label: 'Not started', endpoint: result.emulator.endpoint }
            : { type: 'error', label: 'Unreachable', endpoint: result.emulator.endpoint },
      };
    case 'engine-unreachable':
      return { engine: { type: 'error', label: 'Unreachable', endpoint: engineOrigin }, emulator: NOT_KNOWN };
    case 'engine-error':
      return { engine: { type: 'error', label: 'Error', endpoint: engineOrigin }, emulator: NOT_KNOWN };
  }
}

/** What a screen reader hears when the state changes; the live region says nothing when it stays the same. */
function announcement(result: CheckResult | undefined): string {
  switch (result?.kind) {
    case undefined:
      return '';
    case 'connected':
      return 'Engine connected. Emulator connected.';
    case 'emulator-unreachable':
      return result.reason === 'not_started' ? 'Emulator not started.' : 'Emulator unreachable.';
    case 'engine-unreachable':
      return 'Engine unreachable.';
    case 'engine-error':
      return `Engine error: ${result.code ?? `HTTP status ${String(result.status)}`}.`;
  }
}

function description(result: CheckResult | undefined): string {
  if (result === undefined) {
    return 'Not checked yet.';
  }
  const time = `Last checked ${formatCheckTime(result.checkedAt)}.`;
  // An alert ends with the re-check line, so the interval is said only once.
  return hasAlert(result) ? time : `${time} Checked every 5 seconds.`;
}

// Visually hidden text for a screen reader, in place of a dash.
const screenReaderOnly = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

function RowValue({ label, row }: { label: string; row: Row }) {
  return (
    <SpaceBetween size="xxxs">
      <Box variant="awsui-key-label">{label}</Box>
      <SpaceBetween size="xxxs">
        <StatusIndicator type={row.type}>{row.label}</StatusIndicator>
        {row.endpoint === undefined ? (
          <Box variant="span" color="text-status-inactive">
            <span aria-hidden="true">-</span>
            <span style={screenReaderOnly}>Not known</span>
          </Box>
        ) : (
          <Box variant="code">
            <span style={{ whiteSpace: 'nowrap' }}>{row.endpoint}</span>
          </Box>
        )}
      </SpaceBetween>
    </SpaceBetween>
  );
}

export interface ConnectionStatusProps {
  result: CheckResult | undefined;
  engineOrigin: string | undefined;
  enginePort: number | undefined;
  studioPort: number;
  refreshing: boolean;
  onRefresh: () => void;
  /** Called when an answer removed the part of the alert that had focus, so focus can move to the header "Refresh". */
  onFocusLost: () => void;
}

/** The "Connection" container of Home (requirement 2.1, 3.2): the Engine and Emulator rows and the state's alert. */
export function ConnectionStatus(props: ConnectionStatusProps) {
  const { result, engineOrigin, enginePort, studioPort, refreshing, onRefresh, onFocusLost } = props;
  const { engine, emulator } = rows(result, engineOrigin);

  // The element in the alert that last had focus, kept until focus leaves for another element. A focused element
  // that an answer removes takes focus with it; the header "Refresh" receives it instead.
  const focusedInAlert = useRef<HTMLElement | null>(null);
  const handleFocus = (event: FocusEvent<HTMLDivElement>) => {
    focusedInAlert.current = event.target;
  };
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const left = event.target;
    if (event.relatedTarget instanceof Node) {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        focusedInAlert.current = null;
      }
      return;
    }
    // Focus went nowhere: the user left the alert, unless the element is being removed, which is known once the
    // removal is done.
    queueMicrotask(() => {
      if (left.isConnected && focusedInAlert.current === left) {
        focusedInAlert.current = null;
      }
    });
  };
  useEffect(() => {
    const focused = focusedInAlert.current;
    if (focused !== null && !focused.isConnected) {
      focusedInAlert.current = null;
      onFocusLost();
    }
  }, [result, onFocusLost]);

  return (
    <Container
      header={
        <Header variant="h2" description={description(result)}>
          Connection
        </Header>
      }
    >
      <SpaceBetween size="l">
        <ColumnLayout columns={2} variant="text-grid">
          <RowValue label="Engine" row={engine} />
          <RowValue label="Emulator" row={emulator} />
        </ColumnLayout>
        {engineOrigin !== undefined && enginePort !== undefined && hasAlert(result) && (
          <div onFocus={handleFocus} onBlur={handleBlur}>
            <ConnectionAlert
              result={result}
              engineOrigin={engineOrigin}
              enginePort={enginePort}
              studioPort={studioPort}
              refreshing={refreshing}
              onRefresh={onRefresh}
            />
          </div>
        )}
      </SpaceBetween>
      <LiveRegion hidden>{announcement(result)}</LiveRegion>
    </Container>
  );
}
