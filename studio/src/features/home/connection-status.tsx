import { useEffect, useRef, type FocusEvent } from 'react';

import type { CheckResult } from '../../lib/engine/engine-client';
import { Panel, Section } from '../../ui/section';
import { StatusRow, StatusRows, type StatusKind } from '../../ui/status-rows';
import { ConnectionNotice } from './connection-notice';
import { formatCheckTime, hasNotice } from './connection-state';
import { CopyRegion } from './copy-region';

/** One row of the section: a status and the address it is about; `endpoint` `undefined` shows "-". */
interface Row {
  kind: StatusKind;
  label: string;
  endpoint: string | undefined;
}

const NOT_KNOWN: Row = { kind: 'idle', label: 'Unknown', endpoint: undefined };

function rows(result: CheckResult | undefined, engineOrigin: string | undefined): { engine: Row; emulator: Row } {
  if (result === undefined) {
    return {
      engine: { kind: 'wait', label: 'Checking', endpoint: engineOrigin },
      emulator: { kind: 'wait', label: 'Checking', endpoint: undefined },
    };
  }
  const connected: Row = { kind: 'ok', label: 'Connected', endpoint: engineOrigin };
  switch (result.kind) {
    case 'connected':
      return { engine: connected, emulator: { ...connected, endpoint: result.emulator.endpoint } };
    case 'emulator-unreachable':
      return {
        engine: connected,
        emulator:
          result.reason === 'not_started'
            ? { kind: 'idle', label: 'Not started', endpoint: result.emulator.endpoint }
            : { kind: 'err', label: 'Unreachable', endpoint: result.emulator.endpoint },
      };
    case 'engine-unreachable':
      return { engine: { kind: 'err', label: 'Unreachable', endpoint: engineOrigin }, emulator: NOT_KNOWN };
    case 'engine-error':
      return { engine: { kind: 'err', label: 'Error', endpoint: engineOrigin }, emulator: NOT_KNOWN };
  }
}

/** What a screen reader hears when the state changes; the region's text stays the same while the state does. */
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
  // A notice says the interval in its re-check line, so it is said only once.
  return hasNotice(result) ? time : `${time} Checked every 5 seconds.`;
}

export interface ConnectionStatusProps {
  result: CheckResult | undefined;
  engineOrigin: string | undefined;
  enginePort: number | undefined;
  studioPort: number;
  refreshing: boolean;
  onRefresh: () => void;
  /** Called when an answer removed the part of the notice that had focus, so focus can move to the header "Refresh". */
  onFocusLost: () => void;
}

/** The "Connection" section of Home (requirement R9.1): the Engine and Emulator rows and the state's notice. */
export function ConnectionStatus(props: ConnectionStatusProps) {
  const { result, engineOrigin, enginePort, studioPort, refreshing, onRefresh, onFocusLost } = props;
  const { engine, emulator } = rows(result, engineOrigin);

  // The element in the notice that last had focus, kept until focus leaves for another element. A focused element
  // that an answer removes takes focus with it; the header "Refresh" receives it instead.
  const focusedInNotice = useRef<HTMLElement | null>(null);
  const handleFocus = (event: FocusEvent<HTMLDivElement>) => {
    focusedInNotice.current = event.target;
  };
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const left = event.target;
    if (event.relatedTarget instanceof Node) {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        focusedInNotice.current = null;
      }
      return;
    }
    // Focus went nowhere: the user left the notice, unless the element is being removed, which is known once the
    // removal is done.
    queueMicrotask(() => {
      if (left.isConnected && focusedInNotice.current === left) {
        focusedInNotice.current = null;
      }
    });
  };
  useEffect(() => {
    const focused = focusedInNotice.current;
    if (focused !== null && !focused.isConnected) {
      focusedInNotice.current = null;
      onFocusLost();
    }
  }, [result, onFocusLost]);

  return (
    <Section title="Connection" meta={description(result)}>
      <CopyRegion>
        <Panel>
          <StatusRows>
            <StatusRow label="Engine" kind={engine.kind} status={engine.label} address={engine.endpoint} />
            <StatusRow label="Emulator" kind={emulator.kind} status={emulator.label} address={emulator.endpoint} />
          </StatusRows>
          {engineOrigin !== undefined && enginePort !== undefined && hasNotice(result) && (
            <div onFocus={handleFocus} onBlur={handleBlur}>
              <ConnectionNotice
                result={result}
                engineOrigin={engineOrigin}
                enginePort={enginePort}
                studioPort={studioPort}
                refreshing={refreshing}
                onRefresh={onRefresh}
              />
            </div>
          )}
        </Panel>
      </CopyRegion>
      <div className="st-sr" aria-live="polite" aria-atomic="true">
        {announcement(result)}
      </div>
    </Section>
  );
}
