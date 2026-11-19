import type { MessageKey } from '../../i18n/catalogue';
import { useLanguage } from '../../i18n/language-context';
import type { TargetTest, TestCheck } from '../../lib/engine/targets-client';
import { StatusLine } from '../../ui/status-line';
import type { StatusKind } from '../../ui/status-rows';
import { EngineErrorText, type EngineAnswerError } from './engine-error';

/** Where a connection's test stands: running, answered, past its 15 seconds, or refused by the engine. */
export type TestState =
  | { kind: 'running' }
  | { kind: 'done'; test: TargetTest }
  | { kind: 'timeout' }
  | { kind: 'error'; error: EngineAnswerError };

/** The names of the engine's five checks, in its order (requirement R5). */
const CHECK_NAMES: Readonly<Record<string, MessageKey>> = {
  files: 'connections.test.check.files',
  connection: 'connections.test.check.connection',
  tls: 'connections.test.check.tls',
  health: 'connections.test.check.health',
  credentials: 'connections.test.check.credentials',
};

const STATUS: Readonly<Record<TestCheck['status'], { kind: StatusKind; key: MessageKey }>> = {
  passed: { kind: 'ok', key: 'connections.test.status.passed' },
  failed: { kind: 'err', key: 'connections.test.status.failed' },
  not_run: { kind: 'idle', key: 'connections.test.status.notRun' },
};

function CheckName({ check }: { check: string }) {
  const { t } = useLanguage();
  const key = Object.hasOwn(CHECK_NAMES, check) ? CHECK_NAMES[check] : undefined;
  // A check the engine names that Studio does not know is shown as the engine named it.
  return key === undefined ? <span lang="en">{check}</span> : <>{t(key)}</>;
}

/** The test's one line: "Test passed", or "Test failed: {check}" with the first failed check's name. */
function Summary({ test }: { test: TargetTest }) {
  const { t } = useLanguage();
  if (test.passed) {
    return <>{t('connections.test.passed')}</>;
  }
  const failed = test.checks.find((check) => check.status === 'failed');
  return <>{t('connections.test.failed', { check: <CheckName check={failed?.check ?? ''} /> })}</>;
}

interface TestResultProps {
  state: TestState | undefined;
  /** The engine's message the row already shows under its status; a failed check with the same one does not repeat it. */
  shownMessage?: string | undefined;
}

/**
 * A connection's test, under its row. Its summary sits in a polite live region that is always there, so it is
 * announced once when it appears; the five checks follow in the engine's order, a failed one with its message unless
 * the row already shows that same message.
 */
export function TestResult({ state, shownMessage }: TestResultProps) {
  const { t } = useLanguage();
  const test = state?.kind === 'done' ? state.test : undefined;
  return (
    <div className="st-test">
      <p
        className={`st-test-summary ${test === undefined ? '' : test.passed ? 'ok' : 'err'}`}
        aria-live="polite"
        aria-atomic="true"
      >
        {test !== undefined && <Summary test={test} />}
        {state?.kind === 'timeout' && t('connections.test.timeLimit')}
        {state?.kind === 'error' && <EngineErrorText error={state.error} />}
      </p>
      {test !== undefined && (
        <ol className="st-test-checks">
          {test.checks.map((check) => {
            const status = STATUS[check.status];
            return (
              <li key={check.check}>
                <span className="st-test-check">
                  <CheckName check={check.check} />
                </span>
                <StatusLine small kind={status.kind} status={t(status.key)}>
                  {check.status === 'failed' && check.message !== '' && check.message !== shownMessage ? (
                    <span lang="en">{check.message}</span>
                  ) : undefined}
                </StatusLine>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
