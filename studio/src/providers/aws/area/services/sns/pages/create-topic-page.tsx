import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Tiles from '@cloudscape-design/components/tiles';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { DiscardDialog, type DiscardAnswer } from '../../../components/discard-dialog';
import { actionFailureItem } from '../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import type { ScreenPageProps } from '../../../screens';
import { OPERATIONS, type NewTopic } from '../api';
import { topicHref, topicName, TOPICS_PATH } from '../format';
import { failureOf, useCreateTopic } from '../queries';
import { displayNameMessage, topicNameMessage, type TopicKind } from '../topic-form';

// S2, "Create topic" (issue 536, design task 4): the type, the name, the display name and, for FIFO, content-based
// deduplication. `topic-form.ts` checks the fields before anything is sent; then one `CreateTopic`. The emulator
// answers 200 also for a name it holds with the same attributes, so the result says the topic "is ready" rather than
// created. A refusal stays on the form with the emulator's code and message. What is typed lives in this page alone.

/** The page's title, its `h1`, its crumb and its submit button. */
export const CREATE_TOPIC_TITLE = 'Create topic';

const STANDARD_RULE = '1 to 256 characters: letters, digits, hyphens and underscores.';
const FIFO_RULE = '1 to 256 characters: letters, digits, hyphens and underscores, ending with .fifo.';
const DISPLAY_NAME_RULE = 'Up to 100 characters.';
const CREATING = 'Creating';

const TYPE_ITEMS = [
  { value: 'standard', label: 'Standard', description: 'Its name does not end with .fifo.' },
  {
    value: 'fifo',
    label: 'FIFO',
    description: 'Its name ends with .fifo, and each message is published with a message group ID.',
  },
];

interface TopicFormState {
  kind: TopicKind;
  name: string;
  displayName: string;
  deduplication: boolean;
}

const START: TopicFormState = { kind: 'standard', name: '', displayName: '', deduplication: false };

/** Whether the form differs from how it opened: FIFO chosen, or a field holds text (design task 4 step 3). */
function differs(form: TopicFormState): boolean {
  return form.kind !== START.kind || form.name !== '' || form.displayName !== '';
}

interface Messages {
  name?: string;
  displayName?: string;
}

function messagesOf(form: TopicFormState): Messages {
  const messages: Messages = {};
  const name = topicNameMessage(form.name, form.kind);
  if (name !== undefined) {
    messages.name = name;
  }
  const displayName = displayNameMessage(form.displayName);
  if (displayName !== undefined) {
    messages.displayName = displayName;
  }
  return messages;
}

/**
 * `/aws/sns/topics/create`. "Create topic" checks the fields, then sends `CreateTopic`; on success the topic's page
 * opens with "Topic {name} is ready". A failure stays on the form with what was entered, and takes the focus.
 */
export function CreateTopicPage({ connection }: ScreenPageProps) {
  useShowsResources('topics');
  const navigate = useNavigate();
  const flash = usePageFlash();
  const engineOrigin = connection.engineOrigin;
  const create = useCreateTopic(engineOrigin);

  const [form, setForm] = useState<TopicFormState>(START);
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<FlashItem>();
  const [pending, setPending] = useState(false);

  const nameRef = useRef<InputProps.Ref>(null);
  const displayNameRef = useRef<InputProps.Ref>(null);
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

  const change = useCallback((update: Partial<TopicFormState>) => {
    setForm((current) => ({ ...current, ...update }));
  }, []);

  const messages = tried ? messagesOf(form) : {};

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current) {
      return;
    }
    setTried(true);
    setFailure(undefined);
    const found = messagesOf(form);
    if (found.name !== undefined) {
      nameRef.current?.focus();
      return;
    }
    if (found.displayName !== undefined) {
      displayNameRef.current?.focus();
      return;
    }
    if (engineOrigin === undefined) {
      setFailure(
        actionFailureItem({ kind: 'engine-did-not-answer', operation: OPERATIONS.createTopic }, 'Creating', undefined),
      );
      return;
    }
    busy.current = true;
    setPending(true);
    const controller = new AbortController();
    inFlight.current = controller;
    const fifo = form.kind === 'fifo';
    const topic: NewTopic = {
      name: form.name,
      fifo,
      contentBasedDeduplication: fifo && form.deduplication,
    };
    if (form.displayName !== '') {
      topic.displayName = form.displayName;
    }
    try {
      const arn = await create(topic, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      inFlight.current = null;
      busy.current = false;
      setPending(false);
      flash.handOver(topicHref(arn), [{ type: 'success', content: `Topic ${topicName(arn)} is ready` }]);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      inFlight.current = null;
      busy.current = false;
      setPending(false);
      setFailure(
        actionFailureItem(failureOf(error, OPERATIONS.createTopic), `Creating topic ${form.name}`, engineOrigin),
      );
    }
  };

  // "Cancel" leaves at once while nothing differs from the opening state; otherwise it asks (`aws-area.md`, entry 5).
  const [asking, setAsking] = useState(false);
  const cancelRef = useRef<ButtonProps.Ref>(null);
  const [kept, setKept] = useState(0);
  useEffect(() => {
    if (kept > 0) {
      cancelRef.current?.focus();
    }
  }, [kept]);
  const handleCancel = () => {
    if (differs(form)) {
      setAsking(true);
      return;
    }
    void navigate(TOPICS_PATH);
  };
  const handleDiscardAnswer = useCallback(
    (answer: DiscardAnswer) => {
      setAsking(false);
      if (answer === 'discard') {
        void navigate(TOPICS_PATH);
      } else {
        setKept((count) => count + 1);
      }
    },
    [navigate],
  );

  return (
    <SpaceBetween size="l">
      <Header variant="h1">{CREATE_TOPIC_TITLE}</Header>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Form
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button ref={cancelRef} variant="link" formAction="none" onClick={handleCancel}>
                Cancel
              </Button>
              <Button variant="primary" loading={pending} loadingText={CREATING}>
                {pending ? CREATING : CREATE_TOPIC_TITLE}
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Details</Header>}>
              <SpaceBetween size="l">
                <FormField label="Type">
                  <Tiles
                    value={form.kind}
                    items={TYPE_ITEMS}
                    onChange={({ detail }) => {
                      change({ kind: detail.value as TopicKind });
                    }}
                  />
                </FormField>
                <FormField
                  label="Name"
                  constraintText={form.kind === 'fifo' ? FIFO_RULE : STANDARD_RULE}
                  errorText={messages.name}
                >
                  <Input
                    ref={nameRef}
                    value={form.name}
                    invalid={messages.name !== undefined}
                    autoComplete={false}
                    spellcheck={false}
                    onChange={({ detail }) => {
                      change({ name: detail.value });
                    }}
                  />
                </FormField>
                <FormField
                  label="Display name - optional"
                  constraintText={DISPLAY_NAME_RULE}
                  errorText={messages.displayName}
                >
                  <Input
                    ref={displayNameRef}
                    value={form.displayName}
                    invalid={messages.displayName !== undefined}
                    autoComplete={false}
                    onChange={({ detail }) => {
                      change({ displayName: detail.value });
                    }}
                  />
                </FormField>
                {form.kind === 'fifo' && (
                  <Checkbox
                    checked={form.deduplication}
                    description="A message published without a deduplication ID is given one from its body."
                    onChange={({ detail }) => {
                      change({ deduplication: detail.checked });
                    }}
                  >
                    Content-based deduplication
                  </Checkbox>
                )}
              </SpaceBetween>
            </Container>

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
