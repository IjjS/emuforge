import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { RequestError } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { NO_SUCH_BUCKET, type DeleteBucketResult, type NoSuchBucket } from '../api';
import { actionFailure, type ActionFailure } from '../components/action-failure';
import { BucketNameConfirmation } from '../components/bucket-name-confirmation';
import { confirmsName } from '../components/confirms-name';
import { lineText, pageState, type PageState } from '../components/bucket-read';
import { BucketLoading, BucketNotFound, BucketReadFailure } from '../components/bucket-read-state';
import { Quoted } from '../components/quoted';
import { useAnnouncer } from '../components/use-announcer';
import { BUCKETS_PATH, emptyBucketPath } from '../format';
import { useBucketToDelete, useDeleteBucket, type BucketToDelete } from '../queries';

// S4, "Delete bucket" (issue 256, requirement R7, R9.5, R10, R11): the console's own confirmation page, the bucket's
// name typed as the console asks (`studio/AGENTS.md`, "Inside a provider area"), in the console's words
// (`studio/references/console/s3/delete-bucket.yaml`); its sentences, field label and states in EmuForge's own.
// Nothing is deleted before "Delete bucket" (or Enter) with exactly the name typed.

const TITLE = 'Delete bucket';
const FIELD_LABEL = 'To confirm deletion, enter the name of the bucket.';
const NOT_EMPTY = 'This bucket is not empty';
const NOT_EMPTY_TEXT =
  'A bucket can be deleted only when it holds no object, object version or delete marker. Empty it, then come back to this page.';
const DELETING = 'Deleting the bucket';

/**
 * R9.5: the endpoint is named only while the connection is connected. The name is shown as a name, the endpoint as an
 * address, the words around them as free text (issue 467, requirement R6).
 */
function DeleteSentence({ name, connection }: { name: string; connection: AreaConnection }) {
  const result = connection.result;
  return (
    <Box variant="p">
      <Quoted before="Bucket “" name={name} after="” will be deleted from your local emulator" />
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

/**
 * `/aws/s3/bucket/{name}/delete`: on opening, the bucket of that name and whether it holds anything (R7.1); until
 * then the read's state in place of the form (R11.1). An empty bucket is deleted with "Delete bucket" once the field
 * holds exactly its name (R7.2, R7.4); a bucket that holds anything shows "This bucket is not empty" with "Empty
 * bucket", and the field and "Delete bucket" disabled (R7.3). On success the list opens with the result in the area's
 * flash; any other failure stays on the page, above the buttons, with what was typed (R11.4).
 */
export function DeleteBucketPage({ connection, params }: ScreenPageProps) {
  const name = params.name ?? '';
  useShowsResources('buckets');
  const navigate = useNavigate();
  const flash = usePageFlash();
  const handleFollow = useFollow();
  const engineOrigin = connection.engineOrigin;
  const [announcement, announce] = useAnnouncer();

  const read = useBucketToDelete(engineOrigin, name);
  const { refresh } = read;
  const deleteBucket = useDeleteBucket(engineOrigin);

  const [typed, setTyped] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ActionFailure>();
  /** What `DeleteBucket` answered that changes what the page read: the bucket is not empty, or it is gone. */
  const [refusal, setRefusal] = useState<'not-empty' | NoSuchBucket>();

  const emptyBucketRef = useRef<ButtonProps.Ref>(null);
  /** Set when a refusal for "not empty" disabled the field and the button that held focus. */
  const focusEmptyBucket = useRef(false);

  // A press while an earlier one is in flight sends nothing, also before the page has rendered that it is (a double
  // click, Enter then a click). `DeleteBucket` stops when the page is left, so nothing is handed to a page the user
  // did not go to.
  const busy = useRef(false);
  const inFlight = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      inFlight.current?.abort();
    },
    [],
  );

  const found = pageState(read, connection);
  const state: PageState<BucketToDelete> = refusal === NO_SUCH_BUCKET ? { kind: 'not-found' } : found;
  const notEmpty = state.kind === 'loaded' && (!state.value.empty || refusal === 'not-empty');

  // Kept from the previous render, as React's own pattern for it: what was last seen of the read and the connection,
  // so each change is acted on once, in the render that first shows it.
  const failureLine = state.kind === 'failure' ? lineText(state.view.first) : undefined;
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

  /** Reads the page again; what `DeleteBucket` answered before is replaced by what the read finds. */
  const readAgain = useCallback(() => {
    setWasDown(false);
    setRefusal(undefined);
    refresh();
  }, [refresh]);

  // Once the connection becomes connected again, a failed read, or a page shown while the connection was not
  // connected, is read again by itself (R11.2): after an emulator restart the page says "Bucket not found".
  if (connected !== seenConnected) {
    setSeenConnected(connected);
    if (connected && !pending && (read.failure !== undefined || wasDown)) {
      readAgain();
    }
  }

  // A refusal for "not empty" disables the field and the button that held focus: focus goes to "Empty bucket".
  useEffect(() => {
    if (focusEmptyBucket.current && emptyBucketRef.current !== null) {
      focusEmptyBucket.current = false;
      emptyBucketRef.current.focus();
    }
  });

  const handleDelete = async () => {
    if (busy.current || state.kind !== 'loaded' || notEmpty || !confirmsName(typed, name)) {
      return;
    }
    setFailure(undefined);
    if (engineOrigin === undefined) {
      const shown = actionFailure({ kind: 'engine-did-not-answer', operation: 'DeleteBucket' }, DELETING, undefined);
      setFailure(shown);
      announce(shown.headline);
      return;
    }
    busy.current = true;
    setPending(true);
    const controller = new AbortController();
    inFlight.current = controller;
    let outcome: DeleteBucketResult | NoSuchBucket | { failure: ActionFailure };
    try {
      outcome = await deleteBucket(name, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      if (!(error instanceof RequestError)) {
        // Not a failed request: the page is usable again before the error goes on.
        inFlight.current = null;
        busy.current = false;
        setPending(false);
        throw error;
      }
      outcome = { failure: actionFailure(error.failure, DELETING, engineOrigin) };
    }
    if (controller.signal.aborted) {
      return;
    }
    inFlight.current = null;
    busy.current = false;
    setPending(false);
    if (outcome === 'deleted') {
      flash.handOver(BUCKETS_PATH, [
        {
          type: 'success',
          content: <Quoted before="Bucket “" name={name} after="” was deleted from the local emulator." />,
        },
      ]);
      return;
    }
    if (outcome === 'not-empty') {
      setRefusal('not-empty');
      focusEmptyBucket.current = true;
      announce(NOT_EMPTY);
      return;
    }
    if (outcome === NO_SUCH_BUCKET) {
      setRefusal(NO_SUCH_BUCKET);
      announce('Bucket not found');
      return;
    }
    setFailure(outcome.failure);
    announce(outcome.failure.headline);
  };

  const handleConfirm = () => {
    void handleDelete();
  };

  const handleCancel = () => {
    void navigate(BUCKETS_PATH);
  };

  return (
    <SpaceBetween size="l">
      <Header variant="h1">{TITLE}</Header>
      <div>
        {state.kind === 'loading' && <BucketLoading />}
        {state.kind === 'failure' && <BucketReadFailure view={state.view} onRetry={readAgain} />}
        {state.kind === 'not-found' && <BucketNotFound name={name} />}
        {state.kind === 'loaded' && (
          <Form
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant="link" formAction="none" onClick={handleCancel}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  formAction="none"
                  disabled={notEmpty || !confirmsName(typed, name)}
                  loading={pending}
                  loadingText={DELETING}
                  onClick={handleConfirm}
                >
                  {TITLE}
                </Button>
              </SpaceBetween>
            }
          >
            <SpaceBetween size="l">
              <Container>
                <SpaceBetween size="l">
                  <DeleteSentence name={name} connection={connection} />
                  {notEmpty && (
                    <Alert
                      type="warning"
                      header={NOT_EMPTY}
                      action={
                        <Button ref={emptyBucketRef} href={emptyBucketPath(name)} onFollow={handleFollow}>
                          Empty bucket
                        </Button>
                      }
                    >
                      {NOT_EMPTY_TEXT}
                    </Alert>
                  )}
                  <BucketNameConfirmation
                    label={FIELD_LABEL}
                    name={name}
                    value={typed}
                    disabled={notEmpty}
                    onChange={setTyped}
                    onConfirm={handleConfirm}
                  />
                </SpaceBetween>
              </Container>
              {failure !== undefined && (
                <Alert type={failure.type} header={failure.header}>
                  {failure.detail}
                </Alert>
              )}
            </SpaceBetween>
          </Form>
        )}
        {announcement}
      </div>
    </SpaceBetween>
  );
}
