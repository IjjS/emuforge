import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import type { TextareaProps } from '@cloudscape-design/components/textarea';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { DiscardDialog, type DiscardAnswer } from '../../../components/discard-dialog';
import { DocumentField } from '../../../components/document-field';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem, Code, CodeAndMessage } from '../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { failureOf } from '../../../components/use-token-listing';
import type { ScreenPageProps } from '../../../screens';
import { REGISTER_TITLE, revisionHref, TASK_DEFINITIONS_PATH, TASK_DEFINITIONS_WORD } from '../format';
import { REGISTER_OPERATION } from '../register-api';
import { documentOf, parseDefinition, STARTER } from '../register-form';
import { fromRevisionOf, useFromRevision, useRegisterTaskDefinition } from '../register-queries';

// S10, "Register task definition" (issue 575, requirement S10; design task 4): one field of the definition's JSON,
// started from Studio's starter, or with `?from={family}:{revision}` from that revision's members that
// `RegisterTaskDefinition` takes. "Register" checks only that the text is a JSON object, then sends it unchanged; on
// success the new revision's page opens with the result. A refusal stays on the form, at the field, with the
// emulator's code and message and the text.

const REGISTERING = 'Registering task definition';
const NOT_REGISTERED = 'The emulator did not register the task definition.';
const FIELD_LABEL = 'Task definition JSON';

const PAGE_DESCRIPTION = (
  <>
    A task definition is registered from its JSON, the same document{' '}
    <Code>aws ecs register-task-definition --cli-input-json</Code> takes. A family that exists gets a new revision.
  </>
);

const FIELD_DESCRIPTION = (
  <>
    The emulator plays a task from its containers&apos; <Code>command</Code>: what it <Code>echo</Code>es becomes the
    task&apos;s log, and a <Code>sleep</Code> keeps the task running.
  </>
);

/** `/aws/ecs/task-definitions/register`, with or without `?from={family}:{revision}`. */
export function RegisterPage({ connection }: ScreenPageProps) {
  useShowsResources(TASK_DEFINITIONS_WORD);
  const [search] = useSearchParams();
  const fromText = search.get('from') ?? undefined;
  const given = fromText !== undefined && fromText !== '';
  const [from] = useState(() => (given ? fromRevisionOf(fromText) : undefined));
  const read = useFromRevision(connection.engineOrigin, from);

  let body: ReactNode;
  if (from !== undefined && read.loading) {
    body = (
      <Container>
        <Box textAlign="center" color="inherit">
          <StatusIndicator type="loading">Loading task definition {fromText}</StatusIndicator>
        </Box>
      </Container>
    );
  } else {
    const found = read.value?.found === true ? read.value.revision : undefined;
    const start = found === undefined ? STARTER : documentOf(found.answer);
    body = (
      <RegisterForm
        connection={connection}
        start={start}
        warning={
          given && found === undefined
            ? `Revision ${fromText} could not be read; the starter is shown instead.`
            : undefined
        }
        leaveTo={from === undefined ? TASK_DEFINITIONS_PATH : revisionHref(from.family, from.revision)}
      />
    );
  }

  return (
    <SpaceBetween size="l">
      <Header variant="h1" description={PAGE_DESCRIPTION}>
        {REGISTER_TITLE}
      </Header>
      {body}
    </SpaceBetween>
  );
}

interface RegisterFormProps {
  connection: AreaConnection;
  /** The text the form starts with. */
  start: string;
  /** Why the starter is shown in place of `from`'s revision. */
  warning: string | undefined;
  /** Where "Cancel" leaves to. */
  leaveTo: string;
}

function RegisterForm({ connection, start, warning, leaveTo }: RegisterFormProps) {
  const navigate = useNavigate();
  const flash = usePageFlash();
  const engineOrigin = connection.engineOrigin;
  const register = useRegisterTaskDefinition(engineOrigin);

  const [text, setText] = useState(start);
  const [fieldError, setFieldError] = useState<ReactNode>();
  const [failure, setFailure] = useState<FlashItem>();
  const [pending, setPending] = useState(false);

  const fieldRef = useRef<TextareaProps.Ref>(null);
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
    setFieldError(undefined);
    const parsed = parseDefinition(text);
    if (!parsed.ok) {
      setFieldError(parsed.message);
      fieldRef.current?.focus();
      return;
    }
    if (engineOrigin === undefined) {
      setFailure(
        actionFailureItem({ kind: 'engine-did-not-answer', operation: REGISTER_OPERATION }, REGISTERING, undefined),
      );
      return;
    }
    busy.current = true;
    setPending(true);
    const controller = new AbortController();
    inFlight.current = controller;
    const done = () => {
      inFlight.current = null;
      busy.current = false;
      setPending(false);
    };
    try {
      const registered = await register(parsed.input, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      done();
      const name = `${registered.family}:${String(registered.revision)}`;
      flash.handOver(revisionHref(registered.family, registered.revision), [
        { type: 'success', content: `Task definition ${name} registered.` },
      ]);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      done();
      const refused = failureOf(error, REGISTER_OPERATION);
      if (refused.kind === 'other') {
        setFieldError(
          <>
            {NOT_REGISTERED} <CodeAndMessage code={refused.code} message={refused.message} />
          </>,
        );
        fieldRef.current?.focus();
      } else {
        setFailure(actionFailureItem(refused, REGISTERING, engineOrigin));
      }
    }
  };

  // "Cancel" leaves at once while the text is as the form started; otherwise it asks (`aws-area.md`, entry 5).
  const [asking, setAsking] = useState(false);
  const cancelRef = useRef<ButtonProps.Ref>(null);
  const [kept, setKept] = useState(0);
  useEffect(() => {
    if (kept > 0) {
      cancelRef.current?.focus();
    }
  }, [kept]);
  const handleCancel = () => {
    if (text !== start) {
      setAsking(true);
      return;
    }
    void navigate(leaveTo);
  };
  const handleDiscardAnswer = useCallback(
    (answer: DiscardAnswer) => {
      setAsking(false);
      if (answer === 'discard') {
        void navigate(leaveTo);
      } else {
        setKept((count) => count + 1);
      }
    },
    [navigate, leaveTo],
  );

  return (
    <>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Form
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button ref={cancelRef} variant="link" formAction="none" disabled={pending} onClick={handleCancel}>
                Cancel
              </Button>
              <Button variant="primary" loading={pending} loadingText={REGISTERING}>
                Register
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            {warning !== undefined && <Alert type="warning">{warning}</Alert>}
            {failure !== undefined && (
              <Alert ref={failureRef} type={failure.type} header={failure.header}>
                {failure.content}
              </Alert>
            )}
            <Container>
              <DocumentField
                textareaRef={fieldRef}
                label={FIELD_LABEL}
                description={FIELD_DESCRIPTION}
                errorText={fieldError}
                value={text}
                disabled={pending}
                onChange={(next) => {
                  setText(next);
                }}
              />
            </Container>
          </SpaceBetween>
        </Form>
      </form>
      {/* Mounted only while it asks, so nothing of it is in the page before "Cancel" is pressed. */}
      {asking && <DiscardDialog visible onAnswer={handleDiscardAnswer} />}
    </>
  );
}
