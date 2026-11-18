import { useId, type Ref } from 'react';

import { useLanguage } from '../../i18n/language-context';
import type { Target, TargetInfo } from '../../lib/engine/targets-client';
import { ActionButton } from '../../ui/action-button';
import { InlineCode } from '../../ui/command';
import { Field, Fields, Record } from '../../ui/record-list';
import { StatusLine } from '../../ui/status-line';
import type { StatusKind } from '../../ui/status-rows';
import { TestResult, type TestState } from './test-result';

/** Where a row's info stands: being read, read, or failed. */
export type InfoState = { kind: 'checking' } | { kind: 'read'; info: TargetInfo } | { kind: 'failed' };

/** The emulator's status of a row, as Home words it (requirement R8). */
function EmulatorStatus({ state }: { state: InfoState }) {
  const { t } = useLanguage();
  if (state.kind === 'checking') {
    return <StatusLine kind="wait" status={t('status.checking')} />;
  }
  if (state.kind === 'failed') {
    return <StatusLine kind="idle" status={t('status.notKnown')} />;
  }
  const { health } = state.info;
  if (health.reachable) {
    return <StatusLine kind="ok" status={t('status.connected')} />;
  }
  const kind: StatusKind = health.reason === 'not_started' ? 'idle' : 'err';
  return (
    <StatusLine kind={kind} status={t(health.reason === 'not_started' ? 'status.notStarted' : 'status.unreachable')}>
      {health.message === '' ? undefined : <span lang="en">{health.message}</span>}
    </StatusLine>
  );
}

/** "-" for a value not known, read as "Not known". */
function NotKnown() {
  const { t } = useLanguage();
  return (
    <span className="st-none">
      <span aria-hidden="true">-</span>
      <span className="st-sr">{t('status.notKnown')}</span>
    </span>
  );
}

/** What runs on a row now, so its control reads busy. */
export type RowWork = 'use' | undefined;

interface ConnectionRowProps {
  target: Target;
  info: InfoState;
  test: TestState | undefined;
  work: RowWork;
  onUse: (name: string) => void;
  onTest: (name: string) => void;
  onRemove: (name: string) => void;
  /** The row's "Remove", so focus can come back to it when the dialog closes without a change. */
  removeRef: Ref<HTMLButtonElement>;
}

/**
 * One connection: its name (marked "Target" when it is the target), its endpoint, its emulator's status from its
 * info, where the engine reads its keys, its actions, and its test's result. The target has no "Make target", and
 * its "Remove" is unavailable with the reason as its description.
 */
export function ConnectionRow({ target, info, test, work, onUse, onTest, onRemove, removeRef }: ConnectionRowProps) {
  const { t } = useLanguage();
  const reasonId = useId();
  const { name } = target;
  return (
    <Record marked={target.active}>
      <Fields>
        <Field label={t('connections.column.name')}>
          <span className="st-conn-name">
            <code className="st-conn-code">{name}</code>
            {target.active && <span className="st-mark">{t('connections.targetMark')}</span>}
          </span>
        </Field>
        <Field label={t('connections.column.endpoint')}>
          <code className="st-conn-code small">{target.endpoint}</code>
        </Field>
        <Field label={t('connections.column.emulator')}>
          <EmulatorStatus state={info} />
        </Field>
        <Field label={t('connections.column.keys')}>
          {info.kind === 'read' ? (
            <span className="st-keys">
              {t('connections.keysFrom', { dir: <InlineCode>{info.info.credentialsDir}</InlineCode> })}
            </span>
          ) : (
            <NotKnown />
          )}
        </Field>
      </Fields>
      <div className="st-conn-actions">
        {!target.active && (
          <ActionButton
            small
            busy={work === 'use'}
            ariaLabel={t('connections.makeTargetName', { name })}
            onClick={() => {
              onUse(name);
            }}
          >
            {t(work === 'use' ? 'connections.makingTarget' : 'connections.makeTarget')}
          </ActionButton>
        )}
        <ActionButton
          small
          busy={test?.kind === 'running'}
          ariaLabel={t('connections.testName', { name })}
          onClick={() => {
            onTest(name);
          }}
        >
          {t(test?.kind === 'running' ? 'connections.testing' : 'connections.test')}
        </ActionButton>
        <ActionButton
          ref={removeRef}
          small
          unavailable={target.active}
          describedBy={target.active ? reasonId : undefined}
          ariaLabel={t('connections.removeName', { name })}
          onClick={() => {
            onRemove(name);
          }}
        >
          {t('connections.remove')}
        </ActionButton>
        {target.active && (
          <p id={reasonId} className="st-conn-reason">
            {t('connections.removeUnavailable')}
          </p>
        )}
      </div>
      <TestResult state={test} />
    </Record>
  );
}
