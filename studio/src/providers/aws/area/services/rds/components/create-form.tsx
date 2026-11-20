import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Form from '@cloudscape-design/components/form';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { DiscardDialog, type DiscardAnswer } from '../../../components/discard-dialog';
import { actionFailureItem } from '../../../components/failure-states';
import type { FlashItem } from '../../../components/page-flash';
import { failureOf } from '../../../components/use-token-listing';

// What RDS's two create forms share around their fields (issue 573, design tasks 2 and 4): the page's heading, the
// buttons, the one request and its failure above the buttons, and "Cancel" with the area's discard dialog
// (`aws-area.md`, entry 5). The page checks its fields and builds the request; this sends it once, with a second
// press sending nothing while it is in flight, and stops it when the page is left. A refusal keeps the form as it
// was, every entry with it, and takes the focus.

const CREATING = 'Creating';

export interface CreateFormProps {
  /** The page's `h1` and its submit button: "Create DB instance", "Create DB cluster". */
  title: string;
  description?: string | undefined;
  /** The operation a failure is named by when the engine's address is not known. */
  operation: string;
  /** The header of a failure: "{what} failed". */
  what: string;
  engineOrigin: string | undefined;
  /** Where "Cancel" and "Discard" lead. */
  cancelTo: string;
  /** Whether the form differs from how it opened. */
  differs: boolean;
  /** Checks the fields, shows their messages and focuses the first that failed; `true` when all pass. */
  check: () => boolean;
  /** Sends the one request and answers the identifier of what was created. */
  send: (signal: AbortSignal) => Promise<string>;
  /** What is done with the answer's identifier, in the answer's handler. */
  onCreated: (id: string) => void;
  children: ReactNode;
}

/** A create form of RDS: its fields as `children`, sent once by its submit button. */
export function CreateForm({
  title,
  description,
  operation,
  what,
  engineOrigin,
  cancelTo,
  differs,
  check,
  send,
  onCreated,
  children,
}: CreateFormProps) {
  const navigate = useNavigate();
  const [failure, setFailure] = useState<FlashItem>();
  const [pending, setPending] = useState(false);
  const failureRef = useRef<AlertProps.Ref>(null);

  // A press while an earlier one is in flight sends nothing; the request stops when the page is left.
  const busy = useRef(false);
  const inFlight = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      inFlight.current?.abort();
    },
    [],
  );

  // A failure takes the focus when it is shown, so a screen reader reads it at once.
  useEffect(() => {
    if (failure !== undefined) {
      failureRef.current?.focus();
    }
  }, [failure]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current) {
      return;
    }
    setFailure(undefined);
    if (!check()) {
      return;
    }
    if (engineOrigin === undefined) {
      setFailure(actionFailureItem({ kind: 'engine-did-not-answer', operation }, what, undefined));
      return;
    }
    busy.current = true;
    setPending(true);
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const id = await send(controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      inFlight.current = null;
      busy.current = false;
      setPending(false);
      onCreated(id);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      inFlight.current = null;
      busy.current = false;
      setPending(false);
      setFailure(actionFailureItem(failureOf(error, operation), what, engineOrigin));
    }
  };

  // "Cancel" leaves at once while nothing differs from the opening state; otherwise it asks.
  const [asking, setAsking] = useState(false);
  const cancelRef = useRef<ButtonProps.Ref>(null);
  const [kept, setKept] = useState(0);
  useEffect(() => {
    if (kept > 0) {
      cancelRef.current?.focus();
    }
  }, [kept]);
  const handleCancel = () => {
    if (differs) {
      setAsking(true);
      return;
    }
    void navigate(cancelTo);
  };
  const handleDiscardAnswer = useCallback(
    (answer: DiscardAnswer) => {
      setAsking(false);
      if (answer === 'discard') {
        void navigate(cancelTo);
      } else {
        setKept((count) => count + 1);
      }
    },
    [navigate, cancelTo],
  );

  return (
    <SpaceBetween size="l">
      <Header variant="h1" {...(description === undefined ? {} : { description })}>
        {title}
      </Header>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Form
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button ref={cancelRef} variant="link" formAction="none" onClick={handleCancel}>
                Cancel
              </Button>
              <Button variant="primary" loading={pending} loadingText={CREATING}>
                {pending ? CREATING : title}
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            {children}
            {failure !== undefined && (
              <Alert ref={failureRef} type={failure.type} header={failure.header}>
                {failure.content}
              </Alert>
            )}
          </SpaceBetween>
        </Form>
      </form>
      {/* Mounted only while it asks, so nothing of it is in the page before "Cancel" is pressed. */}
      {asking && <DiscardDialog visible onAnswer={handleDiscardAnswer} />}
    </SpaceBetween>
  );
}
