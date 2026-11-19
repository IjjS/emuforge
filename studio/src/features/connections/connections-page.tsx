import './connections.css';

import { useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { useTargetSeen } from '../../app/target-seen';
import type { MessageKey } from '../../i18n/catalogue';
import { useLanguage } from '../../i18n/language-context';
import {
  EngineNotAnswering,
  EngineRefusal,
  type TargetInfo,
  type TargetsClient,
} from '../../lib/engine/targets-client';
import { Button } from '../../ui/button';
import { InlineCode } from '../../ui/command';
import { RefreshIcon } from '../../ui/icons';
import { Notice } from '../../ui/notice';
import { PageHead } from '../../ui/page-head';
import { RecordList } from '../../ui/record-list';
import { Panel } from '../../ui/section';
import { StatusLine } from '../../ui/status-line';
import { useConnectionCheck } from '../home/use-connection-check';
import { AddConnectionForm, type AddOutcome } from './add-connection-form';
import { ConnectionRow, type InfoState, type RowWork } from './connection-row';
import { EngineErrorText, type EngineAnswerError } from './engine-error';
import { listKey, useConnectionInfos, useConnectionList, useTargetsClient } from './queries';
import { refusalText } from './refusal-text';
import { RemoveDialog } from './remove-dialog';
import type { TestState } from './test-result';

/** The page's result line: a sentence about the change it last made, or the engine's error. */
type ResultLine = { tone: 'ok' | 'err'; key: MessageKey; name: string } | { tone: 'err'; engine: EngineAnswerError };

function answerError(error: EngineRefusal): EngineAnswerError {
  return { status: error.status, code: error.code, message: error.engineMessage };
}

function ResultText({ line }: { line: ResultLine }) {
  const { t } = useLanguage();
  return 'engine' in line ? <EngineErrorText error={line.engine} /> : <>{t(line.key, { name: line.name })}</>;
}

/** The page when the list cannot be shown: the engine not answering, or its error. */
function ListProblem({ error, origin, onRefresh }: { error: unknown; origin: string; onRefresh: () => void }) {
  const { t } = useLanguage();
  const title: ReactNode =
    error instanceof EngineRefusal ? (
      <EngineErrorText error={answerError(error)} />
    ) : (
      t('connections.engineNotAnswering', { origin: <InlineCode>{origin}</InlineCode> })
    );
  return (
    <Panel>
      <div className="st-conn-problem">
        <p>{title}</p>
        <Button small icon={<RefreshIcon />} onClick={onRefresh}>
          {t('connections.refresh')}
        </Button>
      </div>
    </Panel>
  );
}

/** A change the page asks of the engine. */
type ChangeKind = 'use' | 'add' | 'remove';

/**
 * Connections (issue 486, R1, R3–R8): every connection of the engine in its order, with its emulator's status and
 * where its keys are read, "Make target", "Test", "Remove" and "Add connection" (or, in the Compose form, the sentence
 * that it holds one). It runs Home's connection check while open and reads its list again when the target seen
 * changes, so a target changed elsewhere shows here too.
 */
export function ConnectionsPage() {
  const { t, formatTime } = useLanguage();
  // Home's check, every 5 seconds: its answers report the target, which is how a change made elsewhere is seen.
  useConnectionCheck();
  const access = useTargetsClient();
  const { client, enginePort } = access;
  const queryClient = useQueryClient();
  const list = useConnectionList(access);
  const { refetch } = list;
  const { generation, report } = useTargetSeen();
  const known = useRef(generation);

  const [result, setResult] = useState<ResultLine>();
  const [work, setWork] = useState<ReadonlyMap<string, RowWork>>(new Map());
  const [tests, setTests] = useState<ReadonlyMap<string, TestState>>(new Map());
  const [removing, setRemoving] = useState<{ name: string; busy: boolean }>();
  const listHeading = useRef<HTMLHeadingElement>(null);
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  // Ends what the page started when it is left.
  const controller = useRef(new AbortController());
  useEffect(() => {
    const mounted = new AbortController();
    controller.current = mounted;
    return () => {
      mounted.abort();
    };
  }, []);

  // A list answer names the target; a change it makes is the page's own and needs no further reading.
  const data = list.data;
  useEffect(() => {
    if (data !== undefined) {
      known.current = report(data.active, data.startedAt);
    }
  }, [data, report]);

  // The target seen changed by another answer (a health check, the CLI, another tab): the list and infos again.
  useEffect(() => {
    if (generation === known.current) {
      return;
    }
    known.current = generation;
    void refetch({ cancelRefetch: true });
  }, [generation, refetch]);

  const names = data?.targets.map((target) => target.name) ?? [];
  const infos = useConnectionInfos(client, names, list.dataUpdatedAt);

  const readAgain = useCallback(async () => {
    await refetch({ cancelRefetch: true });
  }, [refetch]);

  const setRowWork = (name: string, value: RowWork) => {
    setWork((held) => {
      const next = new Map(held);
      if (value === undefined) {
        next.delete(name);
      } else {
        next.set(name, value);
      }
      return next;
    });
  };

  /**
   * A change the engine did not make: past its time limit, the list is read again and the page says to check; a
   * `404` says `notFound` and reads the list again; any other refusal is the engine's error.
   */
  const changeFailed = async (error: unknown, name: string, notFound: MessageKey, kind: ChangeKind) => {
    if (controller.current.signal.aborted) {
      return;
    }
    if (error instanceof EngineNotAnswering) {
      await readAgain();
      setResult({ tone: 'err', key: 'connections.result.timeLimit', name });
    } else if (error instanceof EngineRefusal && error.code === 'TargetNotFound') {
      setResult({ tone: 'err', key: notFound, name });
      await readAgain();
    } else if (error instanceof EngineRefusal && error.code === 'TargetActive' && kind === 'remove') {
      setResult({ tone: 'err', key: 'connections.removeUnavailable', name });
      await readAgain();
    } else if (error instanceof EngineRefusal) {
      setResult({ tone: 'err', engine: answerError(error) });
    }
  };

  const handleUse = (name: string) => {
    if (client === undefined || work.get(name) === 'use') {
      return;
    }
    setRowWork(name, 'use');
    void (async () => {
      try {
        const answer = await client.use(name, controller.current.signal);
        queryClient.setQueryData(listKey(enginePort), answer);
        setResult({ tone: 'ok', key: 'connections.result.madeTarget', name });
        listHeading.current?.focus();
      } catch (error) {
        await changeFailed(error, name, 'connections.result.removedElsewhere', 'use');
      } finally {
        setRowWork(name, undefined);
      }
    })();
  };

  const handleTest = (name: string) => {
    if (client === undefined || tests.get(name)?.kind === 'running') {
      return;
    }
    const setTest = (state: TestState) => {
      setTests((held) => new Map(held).set(name, state));
    };
    setTest({ kind: 'running' });
    void testOnce(client, name, controller.current.signal).then(async (state) => {
      if (state === 'gone') {
        setTests((held) => {
          const next = new Map(held);
          next.delete(name);
          return next;
        });
        setResult({ tone: 'err', key: 'connections.result.removedElsewhere', name });
        await readAgain();
      } else if (state !== undefined) {
        setTest(state);
      }
    });
  };

  const handleAdd = async (name: string, endpoint: string): Promise<AddOutcome> => {
    if (client === undefined) {
      return { kind: 'kept' };
    }
    try {
      await client.add({ name, endpoint }, controller.current.signal);
      await readAgain();
      setResult({ tone: 'ok', key: 'connections.result.added', name });
      return { kind: 'added' };
    } catch (error) {
      if (error instanceof EngineRefusal) {
        const { key, field } = refusalText(error.code);
        const message = <span lang="en">{error.engineMessage ?? ''}</span>;
        return { kind: 'refused', field, text: t(key, { name, message }) };
      }
      await changeFailed(error, name, 'connections.result.removedElsewhere', 'add');
      return { kind: 'kept' };
    }
  };

  // Where focus goes once the dialog is gone: while it is open, the rest of the document is inert.
  const focusAfterDialog = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (removing === undefined && focusAfterDialog.current !== null) {
      focusAfterDialog.current.focus();
      focusAfterDialog.current = null;
    }
  }, [removing]);

  const closeRemove = (name: string) => {
    focusAfterDialog.current = removeButtons.current.get(name) ?? null;
    setRemoving(undefined);
  };

  /** Closes the dialog after its "Remove" was answered; focus goes to the list's heading, as the row may be gone. */
  const endRemove = () => {
    focusAfterDialog.current = listHeading.current;
    setRemoving(undefined);
  };

  const handleConfirmRemove = () => {
    if (client === undefined || removing === undefined || removing.busy) {
      return;
    }
    const { name } = removing;
    setRemoving({ name, busy: true });
    void (async () => {
      try {
        await client.remove(name, controller.current.signal);
        endRemove();
        setResult({ tone: 'ok', key: 'connections.result.removed', name });
        await readAgain();
      } catch (error) {
        endRemove();
        await changeFailed(error, name, 'connections.result.alreadyRemoved', 'remove');
      }
    })();
  };

  const origin = client?.origin ?? '';
  const loading = list.isPending;
  const problem = list.isError ? list.error : undefined;

  return (
    <>
      <PageHead
        title={t('connections.title')}
        description={t('connections.description')}
        actions={
          <Button
            icon={<RefreshIcon />}
            busy={list.isFetching || client === undefined}
            onClick={() => {
              void readAgain();
            }}
          >
            {t('connections.refresh')}
          </Button>
        }
      />
      <div
        className={result === undefined ? 'st-result' : `st-result ${result.tone}`}
        aria-live="polite"
        aria-atomic="true"
      >
        {result !== undefined && <ResultText line={result} />}
      </div>
      <section className="st-section" aria-labelledby="connections-list-heading">
        <div className="st-section-head">
          <h2 id="connections-list-heading" ref={listHeading} tabIndex={-1}>
            {t('connections.listTitle')}
          </h2>
          {data !== undefined && problem === undefined && (
            <p className="st-meta">{t('connections.lastChecked', { time: formatTime(list.dataUpdatedAt) })}</p>
          )}
        </div>
        {problem !== undefined ? (
          <ListProblem
            error={problem}
            origin={origin}
            onRefresh={() => {
              void readAgain();
            }}
          />
        ) : loading || data === undefined ? (
          <Panel>
            <div className="st-conn-loading" role="status">
              <StatusLine kind="wait" status={t('connections.loading')} />
            </div>
          </Panel>
        ) : (
          <Panel>
            <RecordList>
              {data.targets.map((target, index) => (
                <ConnectionRow
                  key={target.name}
                  target={target}
                  info={infoState(infos[index])}
                  test={tests.get(target.name)}
                  work={work.get(target.name)}
                  onUse={handleUse}
                  onTest={handleTest}
                  onRemove={(name) => {
                    setRemoving({ name, busy: false });
                  }}
                  removeRef={(element) => {
                    if (element === null) {
                      removeButtons.current.delete(target.name);
                    } else {
                      removeButtons.current.set(target.name, element);
                    }
                  }}
                />
              ))}
            </RecordList>
          </Panel>
        )}
      </section>
      {data !== undefined &&
        (data.form === 'compose' ? (
          <section className="st-section">
            <Panel>
              <Notice kind="info" title={t('connections.compose')}>
                {null}
              </Notice>
            </Panel>
          </section>
        ) : (
          <AddConnectionForm onAdd={handleAdd} />
        ))}
      {removing !== undefined && (
        <RemoveDialog
          name={removing.name}
          removing={removing.busy}
          onConfirm={handleConfirmRemove}
          onCancel={() => {
            closeRemove(removing.name);
          }}
        />
      )}
    </>
  );
}

function infoState(query: UseQueryResult<TargetInfo> | undefined): InfoState {
  if (query === undefined || query.isPending) {
    return { kind: 'checking' };
  }
  return query.isError ? { kind: 'failed' } : { kind: 'read', info: query.data };
}

/**
 * One test of `name`: its result, `'gone'` when the engine no longer holds the connection, or `undefined` when the page
 * was left. Past its 15 seconds, or with no answer at all, it is a test that did not finish.
 */
async function testOnce(
  client: TargetsClient,
  name: string,
  signal: AbortSignal,
): Promise<TestState | 'gone' | undefined> {
  try {
    return { kind: 'done', test: await client.test(name, signal) };
  } catch (error) {
    if (signal.aborted) {
      return undefined;
    }
    if (error instanceof EngineRefusal) {
      return error.code === 'TargetNotFound' ? 'gone' : { kind: 'error', error: answerError(error) };
    }
    return { kind: 'timeout' };
  }
}
