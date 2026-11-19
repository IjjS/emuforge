import AttributeEditor from '@cloudscape-design/components/attribute-editor';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Link from '@cloudscape-design/components/link';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Textarea, { type TextareaProps } from '@cloudscape-design/components/textarea';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';

import { CopyValue } from '../../../components/copy-value';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem, CodeAndMessage, useAnnouncer } from '../../../components/failure-states';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import { listSubscriptions, OPERATIONS, type OutgoingMessage } from '../api';
import { topicHref } from '../format';
import {
  firstFault,
  publishFaults,
  type AttributeRow,
  type PublishFaults,
  type PublishForm,
  type PublishResult,
} from '../publish-form';
import { failureOf, usePublish } from '../queries';

// S3's "Publish" tab (issue 536, design task 3): the message, the subject, message attributes and, for a FIFO topic,
// the message group ID and deduplication ID; "Publish" sends one `Publish` once `publish-form.ts` finds nothing at
// fault. "Result" below the form says what the emulator answered and where the message went. The form's text and the
// last result are the topic page's, so they are kept across its tabs; the developer's text and the emulator's ids are
// rendered as text only.

export interface PublishTabProps {
  topicArn: string;
  fifo: boolean;
  contentBasedDeduplication: boolean;
  connection: AreaConnection;
  /** The form's text, kept by the topic's page across its tabs. */
  form: PublishForm;
  onFormChange: (form: PublishForm) => void;
  /** The last publish's outcome; `undefined` before the first. */
  result: PublishResult | undefined;
  onResultChange: (result: PublishResult | undefined) => void;
}

const TYPES: readonly SelectProps.Option[] = [
  { value: 'String', label: 'String' },
  { value: 'Number', label: 'Number' },
];

const PUBLISHED = 'Published';
const NOT_PUBLISHED = 'The message was not published';
const ACCEPTED = 'The emulator accepted the message.';
const DELIVERS_WHERE_ALLOWED =
  'The emulator accepted the message. A subscription receives it only if the policy of its queue or function allows this topic; Delivery on the Subscriptions tab says which do.';
const NO_SUBSCRIPTIONS = 'This topic has no subscriptions, so the message was delivered nowhere.';
const NO_FAULTS: PublishFaults = { attributes: [] };

/** Where a published message went, as far as the tab's read of the subscriptions says; no read, no claim. */
function sentenceOf(subscribed: boolean | undefined): string {
  if (subscribed === undefined) {
    return ACCEPTED;
  }
  return subscribed ? DELIVERS_WHERE_ALLOWED : NO_SUBSCRIPTIONS;
}

/** The outcome of a publish that failed, after its heading: the emulator's code and message, or what did not answer. */
function FailureWords({
  result,
  engineOrigin,
}: {
  result: PublishResult & { kind: 'refused' };
  engineOrigin?: string;
}) {
  const { failure } = result;
  if (failure.kind === 'other') {
    return <CodeAndMessage code={failure.code} message={failure.message} />;
  }
  const item = actionFailureItem(failure, 'Publishing', engineOrigin);
  return (
    <SpaceBetween size="xxxs">
      <Box variant="strong" color="inherit">
        {item.header}
      </Box>
      {item.content !== undefined && <span>{item.content}</span>}
    </SpaceBetween>
  );
}

/** "Result": nothing yet, what the emulator answered, or why the message was not published. */
function Result({
  result,
  topicArn,
  engineOrigin,
}: {
  result: PublishResult | undefined;
  topicArn: string;
  engineOrigin: string | undefined;
}) {
  const handleFollow = useFollow();
  let body: ReactNode;
  if (result === undefined) {
    body = <Box color="text-status-inactive">Nothing published yet</Box>;
  } else if (result.kind === 'published') {
    const items: { label: string; value: ReactNode }[] = [
      { label: 'Message ID', value: <CopyValue label="Message ID" value={result.published.messageId} kind="name" /> },
    ];
    if (result.published.sequenceNumber !== undefined) {
      items.push({
        label: 'Sequence number',
        value: <ValueText kind="name" value={result.published.sequenceNumber} />,
      });
    }
    body = (
      <SpaceBetween size="m">
        <StatusIndicator type="success">{PUBLISHED}</StatusIndicator>
        <KeyValuePairs columns={2} items={items} />
        <SpaceBetween size="xxs">
          <Box variant="p">{sentenceOf(result.subscribed)}</Box>
          <Link href={topicHref(topicArn)} onFollow={handleFollow}>
            See this topic&apos;s subscriptions
          </Link>
        </SpaceBetween>
      </SpaceBetween>
    );
  } else {
    body = (
      <SpaceBetween size="xs">
        <StatusIndicator type="error">{NOT_PUBLISHED}</StatusIndicator>
        <div>
          <FailureWords result={result} {...(engineOrigin === undefined ? {} : { engineOrigin })} />
        </div>
      </SpaceBetween>
    );
  }
  return <Container header={<Header variant="h2">Result</Header>}>{body}</Container>;
}

/** "Publish": the form, then "Result". */
export function PublishTab({
  topicArn,
  fifo,
  contentBasedDeduplication,
  connection,
  form,
  onFormChange,
  result,
  onResultChange,
}: PublishTabProps) {
  const engineOrigin = connection.engineOrigin;
  const send = usePublish(engineOrigin);
  const [announcement, announce] = useAnnouncer();

  // The messages are shown once "Publish" has been pressed, and follow what is typed after.
  const [tried, setTried] = useState(false);
  const rules = { fifo, contentBasedDeduplication };
  const faults = tried ? publishFaults(form, rules) : NO_FAULTS;

  // A press while a publish is in flight sends nothing. The publish is not ended when the tab is left: its outcome is
  // the page's, shown when the tab is opened again.
  const [publishing, setPublishing] = useState(false);
  const busy = useRef(false);

  const messageRef = useRef<TextareaProps.Ref>(null);
  const groupRef = useRef<InputProps.Ref>(null);
  const deduplicationRef = useRef<InputProps.Ref>(null);
  const attributesPlace = useRef<HTMLDivElement>(null);

  const change = (next: Partial<PublishForm>) => {
    onFormChange({ ...form, ...next });
  };
  const changeRow = (index: number, next: Partial<AttributeRow>) => {
    change({ attributes: form.attributes.map((row, at) => (at === index ? { ...row, ...next } : row)) });
  };

  const focusFirstFault = (found: PublishFaults): boolean => {
    const first = firstFault(found);
    if (first === undefined) {
      return false;
    }
    switch (first.field) {
      case 'message':
        messageRef.current?.focus();
        break;
      case 'attribute': {
        const label = `${first.part === 'name' ? 'Name' : 'Value'} of attribute ${String(first.row + 1)}`;
        attributesPlace.current?.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)?.focus();
        break;
      }
      case 'groupId':
        groupRef.current?.focus();
        break;
      case 'deduplicationId':
        deduplicationRef.current?.focus();
        break;
    }
    return true;
  };

  /**
   * Whether the topic has a subscription, from one read of its first page made now; `undefined` when it cannot be
   * read. A one-off read, not a listing: what it decides is kept with the result and never read again.
   */
  const subscribedNow = async (signal: AbortSignal): Promise<boolean | undefined> => {
    if (engineOrigin === undefined) {
      return undefined;
    }
    try {
      const page = await listSubscriptions(engineOrigin, topicArn, undefined, signal);
      return page.subscriptions.length > 0;
    } catch {
      return undefined;
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current) {
      return;
    }
    setTried(true);
    if (focusFirstFault(publishFaults(form, rules))) {
      return;
    }
    const message: OutgoingMessage = { topicArn, message: form.message };
    if (form.subject !== '') {
      message.subject = form.subject;
    }
    if (form.attributes.length > 0) {
      message.attributes = form.attributes.map((row) => ({ name: row.name, type: row.type, value: row.value }));
    }
    if (fifo) {
      message.groupId = form.groupId;
      if (form.deduplicationId !== '') {
        message.deduplicationId = form.deduplicationId;
      }
    }
    busy.current = true;
    setPublishing(true);
    const signal = new AbortController().signal;
    let outcome: PublishResult;
    try {
      outcome = { kind: 'published', published: await send(message, signal) };
    } catch (error) {
      outcome = { kind: 'refused', failure: failureOf(error, OPERATIONS.publish) };
    }
    if (outcome.kind === 'published') {
      const subscribed = await subscribedNow(signal);
      if (subscribed !== undefined) {
        outcome.subscribed = subscribed;
      }
    }
    busy.current = false;
    setPublishing(false);
    onResultChange(outcome);
    announce(outcome.kind === 'published' ? PUBLISHED : NOT_PUBLISHED);
  };

  return (
    <SpaceBetween size="l">
      {announcement}
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Form
          actions={
            <Button formAction="submit" variant="primary" loading={publishing} loadingText="Publishing">
              {publishing ? 'Publishing' : 'Publish'}
            </Button>
          }
        >
          <Container header={<Header variant="h2">Publish</Header>}>
            <SpaceBetween size="l">
              <FormField
                label="Message"
                description="The message body sent to the topic's subscriptions."
                errorText={faults.message}
                stretch
              >
                <Textarea
                  ref={messageRef}
                  value={form.message}
                  rows={6}
                  invalid={faults.message !== undefined}
                  onChange={({ detail }) => {
                    change({ message: detail.value });
                  }}
                />
              </FormField>
              <FormField label="Subject - optional">
                <Input
                  value={form.subject}
                  onChange={({ detail }) => {
                    change({ subject: detail.value });
                  }}
                />
              </FormField>
              {fifo && (
                <FormField label="Message group ID" errorText={faults.groupId}>
                  <Input
                    ref={groupRef}
                    value={form.groupId}
                    invalid={faults.groupId !== undefined}
                    onChange={({ detail }) => {
                      change({ groupId: detail.value });
                    }}
                  />
                </FormField>
              )}
              {fifo && (
                <FormField
                  label={contentBasedDeduplication ? 'Message deduplication ID - optional' : 'Message deduplication ID'}
                  {...(contentBasedDeduplication ? { description: 'Leave empty to deduplicate by the body.' } : {})}
                  errorText={faults.deduplicationId}
                >
                  <Input
                    ref={deduplicationRef}
                    value={form.deduplicationId}
                    invalid={faults.deduplicationId !== undefined}
                    onChange={({ detail }) => {
                      change({ deduplicationId: detail.value });
                    }}
                  />
                </FormField>
              )}
              <div ref={attributesPlace}>
                <FormField label="Message attributes - optional" stretch>
                  <AttributeEditor<AttributeRow>
                    items={form.attributes}
                    addButtonText="Add attribute"
                    removeButtonText="Remove"
                    empty="No message attributes."
                    onAddButtonClick={() => {
                      change({ attributes: [...form.attributes, { name: '', type: 'String', value: '' }] });
                    }}
                    onRemoveButtonClick={({ detail }) => {
                      change({ attributes: form.attributes.filter((_, at) => at !== detail.itemIndex) });
                    }}
                    definition={[
                      {
                        label: 'Name',
                        control: (row, index) => (
                          <Input
                            value={row.name}
                            ariaLabel={`Name of attribute ${String(index + 1)}`}
                            invalid={faults.attributes[index]?.name !== undefined}
                            onChange={({ detail }) => {
                              changeRow(index, { name: detail.value });
                            }}
                          />
                        ),
                        errorText: (_, index) => faults.attributes[index]?.name,
                      },
                      {
                        label: 'Type',
                        control: (row, index) => (
                          <Select
                            selectedOption={TYPES.find((option) => option.value === row.type) ?? null}
                            options={[...TYPES]}
                            ariaLabel={`Type of attribute ${String(index + 1)}`}
                            onChange={({ detail }) => {
                              changeRow(index, {
                                type: detail.selectedOption.value === 'Number' ? 'Number' : 'String',
                              });
                            }}
                          />
                        ),
                      },
                      {
                        label: 'Value',
                        control: (row, index) => (
                          <Input
                            value={row.value}
                            ariaLabel={`Value of attribute ${String(index + 1)}`}
                            invalid={faults.attributes[index]?.value !== undefined}
                            onChange={({ detail }) => {
                              changeRow(index, { value: detail.value });
                            }}
                          />
                        ),
                        errorText: (_, index) => faults.attributes[index]?.value,
                      },
                    ]}
                  />
                </FormField>
              </div>
            </SpaceBetween>
          </Container>
        </Form>
      </form>
      <Result result={result} topicArn={topicArn} engineOrigin={engineOrigin} />
    </SpaceBetween>
  );
}
