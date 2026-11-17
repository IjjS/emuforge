import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import type { AreaConnection } from '../../../components/emulator-line';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { OPERATIONS } from '../api';
import { actionFailure } from '../components/action-failure';
import { BucketNameConfirmation } from '../components/bucket-name-confirmation';
import { lineText, pageState } from '../components/bucket-read';
import { BucketLoading, BucketNotFound, BucketReadFailure } from '../components/bucket-read-state';
import { confirmsName } from '../components/confirms-name';
import { emptyingResult, type EmptyingState } from '../components/emptying-result';
import { EmptyingStatus } from '../components/emptying-status';
import { Quoted } from '../components/quoted';
import { useAnnouncer } from '../components/use-announcer';
import { useStatusTitle } from '../components/use-status-title';
import { emptyBucket, type EmptyingCounts, type EmptyingResult } from '../empty-bucket';
import { BUCKETS_PATH } from '../format';
import { useBucketLookup, useEmptyingOperations } from '../queries';

// S3, "Empty bucket" (issue 256, requirement R8, R9.4, R10, R11): the console's own confirmation page, the bucket's
// name typed as the console asks (`studio/AGENTS.md`, "Inside a provider area"), in the console's words
// (`studio/references/console/s3/empty-bucket.yaml`); its sentences, field label, status and states in EmuForge's own.
// Nothing is deleted before "Empty" (or Enter) with exactly the name typed. "Empty bucket: Status" is a state of this
// page at the same address, not a route; the emptying runs in the page and stops when the page is left.

const TITLE = 'Empty bucket';
const STATUS_TITLE = 'Empty bucket: Status';
const FIELD_LABEL = 'To confirm, enter the name of the bucket.';
const RUNS_HERE = 'Emptying runs in this page. Leaving the page stops it.';
const EMPTYING = 'Emptying the bucket';

const NO_COUNTS: EmptyingCounts = { deleted: 0, failures: [] };

/**
 * R9.4: the endpoint is named only while the connection is connected. The name is shown as a name, the endpoint as an
 * address, the words around them as free text (issue 467, requirement R6).
 */
function EmptySentence({ name, connection }: { name: string; connection: AreaConnection }) {
  const result = connection.result;
  return (
    <Box variant="p">
      <Quoted
        before="Every object, object version and delete marker in bucket “"
        name={name}
        after="” will be deleted from your local emulator"
      />
      {result?.kind === 'connected' && (
        <>
          <ValueText kind="text" value=" at " />
          <Box variant="code" display="inline">
            <ValueText kind="address" value={result.emulator.endpoint} />
          </Box>
        </>
      )}
      <ValueText kind="text" value=". This cannot be undone." />
    </Box>
  );
}

/** What the page shows after "Empty": the status, or "Bucket not found" when the emptying found no bucket (R8.6). */
type Status = EmptyingState | { kind: 'not-found' };

/**
 * `/aws/s3/bucket/{name}/empty`: on opening, the bucket of that name and nothing else (R8.1); until then the read's
 * state in place of the form (R11.1). "Empty", once the field holds exactly the name, replaces the form with the
 * status, moves focus to the `h1` and starts the emptying (R8.2, R8.3); its result is shown in the status and in the
 * area's flash (R8.5); a request that fails as a whole stops it, with "Retry" (R8.6). Leaving the page stops it after
 * the request in flight (R8.4).
 */
export function EmptyBucketPage({ connection, params }: ScreenPageProps) {
  const name = params.name ?? '';
  useShowsResources('buckets');
  const navigate = useNavigate();
  const flash = usePageFlash();
  const engineOrigin = connection.engineOrigin;
  const [announcement, announce] = useAnnouncer();

  const read = useBucketLookup(engineOrigin, name);
  const { refresh } = read;
  const operations = useEmptyingOperations(engineOrigin, name);

  const [typed, setTyped] = useState('');
  const [status, setStatus] = useState<Status>();
  useStatusTitle(TITLE, status === undefined ? undefined : STATUS_TITLE);

  // The `h1`, which takes focus when the status replaces the form (R8.2).
  const headerRef = useRef<HTMLDivElement>(null);
  const focusHeading = useRef(false);
  useEffect(() => {
    if (!focusHeading.current) {
      return;
    }
    focusHeading.current = false;
    const heading = headerRef.current?.querySelector('h1');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
  });

  // The run in flight: one at a time, and stopped when the page is left (R8.4).
  const running = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      running.current?.abort();
    },
    [],
  );

  const found = pageState(read, connection);

  // Kept from the previous render, as React's own pattern for it (as the delete page): what was last seen of the read
  // and the connection, so each change is acted on once, in the render that first shows it.
  const failureLine = status === undefined && found.kind === 'failure' ? lineText(found.view.first) : undefined;
  const [seenFailureLine, setSeenFailureLine] = useState<string>();
  const connected = connection.result?.kind === 'connected';
  const [seenConnected, setSeenConnected] = useState(connected);
  // Whether the connection was not connected (a state other than "Checking") since the page last read: the emulator
  // may have restarted then, so the bucket shown may be gone.
  const down = connection.result !== undefined && !connected;
  const [wasDown, setWasDown] = useState(down);
  if (down && !wasDown) {
    setWasDown(true);
  }
  // A failure state is announced once, with its first line (R11.2).
  if (failureLine !== seenFailureLine) {
    setSeenFailureLine(failureLine);
    if (failureLine !== undefined) {
      announce(failureLine);
    }
  }

  const readAgain = useCallback(() => {
    setWasDown(false);
    refresh();
  }, [refresh]);

  // Before "Empty", once the connection becomes connected again, a failed read, or a page shown while the connection
  // was not connected, is read again by itself (R11.2): after an emulator restart the page says "Bucket not found".
  if (connected !== seenConnected) {
    setSeenConnected(connected);
    if (connected && status === undefined && (read.failure !== undefined || wasDown)) {
      readAgain();
    }
  }

  /** Runs the emptying from the bucket's start, going on from `from` ("Retry", R8.6). */
  const run = async (from: EmptyingCounts) => {
    if (running.current !== null) {
      return;
    }
    if (operations === undefined) {
      const failure = actionFailure(
        { kind: 'engine-did-not-answer', operation: OPERATIONS.listObjectVersions },
        EMPTYING,
        engineOrigin,
      );
      setStatus({ kind: 'failed', counts: from, failure });
      announce(failure.headline);
      return;
    }
    const controller = new AbortController();
    running.current = controller;
    setStatus({ kind: 'running', counts: from });
    announce(EMPTYING);
    let result: EmptyingResult;
    try {
      result = await emptyBucket(operations, controller.signal, {
        from,
        onProgress: (counts) => {
          if (!controller.signal.aborted) {
            setStatus({ kind: 'running', counts });
          }
        },
      });
    } finally {
      if (running.current === controller) {
        running.current = null;
      }
    }
    if (controller.signal.aborted || result.outcome === 'stopped') {
      return;
    }
    const counts: EmptyingCounts = { deleted: result.deleted, failures: result.failures };
    switch (result.outcome) {
      case 'finished': {
        setStatus({ kind: 'finished', counts });
        const shown = emptyingResult(name, counts);
        flash.show([
          { type: shown.type, content: <Quoted before={shown.before} name={shown.name} after={shown.after} /> },
        ]);
        return;
      }
      case 'no-such-bucket':
        setStatus({ kind: 'not-found' });
        announce('Bucket not found');
        return;
      case 'failed': {
        const failure = actionFailure(result.failure, EMPTYING, engineOrigin);
        setStatus({ kind: 'failed', counts, failure });
        announce(failure.headline);
        return;
      }
    }
  };

  const handleEmpty = () => {
    if (status !== undefined || found.kind !== 'loaded' || !confirmsName(typed, name)) {
      return;
    }
    focusHeading.current = true;
    void run(NO_COUNTS);
  };

  const handleRetry = () => {
    if (status?.kind === 'failed') {
      void run(status.counts);
    }
  };

  const handleCancel = () => {
    void navigate(BUCKETS_PATH);
  };

  return (
    <SpaceBetween size="l">
      <div ref={headerRef}>
        <Header variant="h1">{status === undefined ? TITLE : STATUS_TITLE}</Header>
      </div>
      <div>
        {status === undefined && (
          <>
            {found.kind === 'loading' && <BucketLoading />}
            {found.kind === 'failure' && <BucketReadFailure view={found.view} onRetry={readAgain} />}
            {found.kind === 'not-found' && <BucketNotFound name={name} />}
            {found.kind === 'loaded' && (
              <Form
                actions={
                  <SpaceBetween direction="horizontal" size="xs">
                    <Button variant="link" formAction="none" onClick={handleCancel}>
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      formAction="none"
                      disabled={!confirmsName(typed, name)}
                      onClick={handleEmpty}
                    >
                      Empty
                    </Button>
                  </SpaceBetween>
                }
              >
                <Container>
                  <SpaceBetween size="l">
                    <SpaceBetween size="xs">
                      <EmptySentence name={name} connection={connection} />
                      <Box variant="p">{RUNS_HERE}</Box>
                    </SpaceBetween>
                    <BucketNameConfirmation
                      label={FIELD_LABEL}
                      name={name}
                      value={typed}
                      onChange={setTyped}
                      onConfirm={handleEmpty}
                    />
                  </SpaceBetween>
                </Container>
              </Form>
            )}
          </>
        )}
        {status?.kind === 'not-found' && <BucketNotFound name={name} />}
        {status !== undefined && status.kind !== 'not-found' && (
          <EmptyingStatus name={name} state={status} onRetry={handleRetry} />
        )}
        {announcement}
      </div>
    </SpaceBetween>
  );
}
