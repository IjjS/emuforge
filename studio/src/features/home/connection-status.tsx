import './connection-status.css';

import { useEffect, useRef, type FocusEvent } from 'react';

import type { MessageKey } from '../../i18n/catalogue';
import { useLanguage } from '../../i18n/language-context';
import type { Messages } from '../../i18n/messages';
import { targetOf, type CheckResult } from '../../lib/engine/engine-client';
import { ButtonLink } from '../../ui/button-link';
import { Panel, Section } from '../../ui/section';
import { StatusRow, StatusRows, type StatusKind } from '../../ui/status-rows';
import { ConnectionNotice } from './connection-notice';
import { hasNotice } from './connection-state';
import { CopyRegion } from './copy-region';
import { RECHECK_MS } from './use-connection-check';

/** One row of the section: a status and the address it is about; `endpoint` `undefined` shows "-". */
interface Row {
  kind: StatusKind;
  label: MessageKey;
  endpoint: string | undefined;
}

const NOT_KNOWN: Row = { kind: 'idle', label: 'status.unknown', endpoint: undefined };

function rows(result: CheckResult | undefined, engineOrigin: string | undefined): { engine: Row; emulator: Row } {
  if (result === undefined) {
    return {
      engine: { kind: 'wait', label: 'status.checking', endpoint: engineOrigin },
      emulator: { kind: 'wait', label: 'status.checking', endpoint: undefined },
    };
  }
  const connected: Row = { kind: 'ok', label: 'status.connected', endpoint: engineOrigin };
  switch (result.kind) {
    case 'connected':
      return { engine: connected, emulator: { ...connected, endpoint: result.emulator.endpoint } };
    case 'emulator-unreachable':
      return {
        engine: connected,
        emulator:
          result.reason === 'not_started'
            ? { kind: 'idle', label: 'status.notStarted', endpoint: result.emulator.endpoint }
            : { kind: 'err', label: 'status.unreachable', endpoint: result.emulator.endpoint },
      };
    case 'engine-unreachable':
      return { engine: { kind: 'err', label: 'status.unreachable', endpoint: engineOrigin }, emulator: NOT_KNOWN };
    case 'engine-error':
      return { engine: { kind: 'err', label: 'status.error', endpoint: engineOrigin }, emulator: NOT_KNOWN };
  }
}

/** What a screen reader hears when the state changes; the region's text stays the same while the state does. */
function announcement({ t }: Messages, result: CheckResult | undefined): string {
  switch (result?.kind) {
    case undefined:
      return '';
    case 'connected':
      return t('announce.connected');
    case 'emulator-unreachable':
      return t(result.reason === 'not_started' ? 'announce.notStarted' : 'announce.emulatorUnreachable');
    case 'engine-unreachable':
      return t('announce.engineUnreachable');
    case 'engine-error':
      return result.code !== undefined
        ? t('announce.engineErrorCode', { code: result.code })
        : t('announce.engineErrorStatus', { status: String(result.status) });
  }
}

function description({ t, plural, formatTime }: Messages, result: CheckResult | undefined): string {
  if (result === undefined) {
    return t('connection.notChecked');
  }
  const time = formatTime(result.checkedAt);
  // A notice says the interval in its re-check line, so it is said only once.
  return hasNotice(result)
    ? t('connection.lastChecked', { time })
    : plural('connection.lastCheckedEvery', RECHECK_MS / 1000, { time });
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

/**
 * The "Connection" section of Home (requirement R9.1): the Engine and Emulator rows, below them the target the health
 * answer named and the way to the connections page (issue 486, R2), and the state's notice.
 */
export function ConnectionStatus(props: ConnectionStatusProps) {
  const { result, engineOrigin, enginePort, studioPort, refreshing, onRefresh, onFocusLost } = props;
  const language = useLanguage();
  const { t } = language;
  const { engine, emulator } = rows(result, engineOrigin);
  // Only an answer from the engine's health route names a target; the engine states know none.
  const target = result === undefined ? undefined : targetOf(result);

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
    <Section title={t('connection.title')} meta={description(language, result)}>
      <CopyRegion>
        <Panel>
          <StatusRows>
            <StatusRow
              label={t('connection.engine')}
              kind={engine.kind}
              status={t(engine.label)}
              address={engine.endpoint}
            />
            <StatusRow
              label={t('connection.emulator')}
              kind={emulator.kind}
              status={t(emulator.label)}
              address={emulator.endpoint}
            />
          </StatusRows>
          {/* Outside the rows, which stay as they were; the live region below does not name the target, so a change
              of target alone announces nothing. */}
          <div className="st-target-strip">
            {target !== undefined && (
              <p>{t('connection.target', { target: <code className="st-code">{target}</code> })}</p>
            )}
            <ButtonLink to="/connections">{t('connection.manage')}</ButtonLink>
          </div>
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
        {announcement(language, result)}
      </div>
    </Section>
  );
}
