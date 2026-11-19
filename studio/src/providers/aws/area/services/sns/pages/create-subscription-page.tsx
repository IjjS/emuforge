import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import type { SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Tiles from '@cloudscape-design/components/tiles';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { DiscardDialog, type DiscardAnswer } from '../../../components/discard-dialog';
import { actionFailureItem, CodeAndMessage, ReadFailure, readFailureState } from '../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import type { ScreenPageProps } from '../../../screens';
import { NOT_FOUND, OPERATIONS, type AllowOutcome, type DeliveryProtocol } from '../api';
import { EndpointSelect, type EndpointChoice } from '../components/endpoint-select';
import { topicHref, topicName, TOPICS_PATH } from '../format';
import { failureOf, useAllowDelivery, usePageSignal, useReadQueue, useSubscribe, useTopic } from '../queries';

// S4, "Create subscription" (issue 536, design tasks 2 and 6): a queue or a function the emulator holds, chosen by its
// name, subscribed to the topic of the page's address; then, while "Allow this topic to deliver to it" is on, the
// statement or the permission that lets the topic deliver is added unless the policy already has one or Studio cannot
// tell. Each step is sent only once the one before succeeded. A refused `Subscribe` stays on the form; once it
// succeeded the topic's page opens with the result, which says so when the policy was not changed.

/** The page's title, its `h1` and its last crumb. */
export const CREATE_SUBSCRIPTION_TITLE = 'Create subscription';

const SUBSCRIBING = 'Subscribing';
const QUEUE_GONE = 'The queue is no longer in the emulator.';

const PROTOCOL_ITEMS = [
  { value: 'sqs', label: 'Amazon SQS', description: 'Notifications arrive in a queue as messages.' },
  { value: 'lambda', label: 'AWS Lambda', description: 'A function is invoked with each notification.' },
];

const CHOOSE: Record<DeliveryProtocol, string> = { sqs: 'Choose a queue.', lambda: 'Choose a function.' };

const ALLOW_DESCRIPTION: Record<DeliveryProtocol, string> = {
  sqs: "Adds a statement to the queue's policy that lets this topic send messages to it. Without one the emulator delivers nothing.",
  lambda:
    'Adds a permission to the function that lets this topic invoke it. Without one the emulator delivers nothing.',
};

interface SubscribeForm {
  protocol: DeliveryProtocol;
  endpoint: EndpointChoice | undefined;
  allow: boolean;
}

const START: SubscribeForm = { protocol: 'sqs', endpoint: undefined, allow: true };

/** Whether anything differs from what the form showed when it opened (`aws-area.md`, entry 5). */
function differs(form: SubscribeForm): boolean {
  return form.protocol !== START.protocol || form.endpoint !== undefined || form.allow !== START.allow;
}

/** Why the policy was not changed, when adding to it failed: the emulator's code and message, or what did not answer. */
function failureReason(failure: RequestFailure, engineOrigin: string | undefined): ReactNode {
  if (failure.kind === 'other') {
    return <CodeAndMessage code={failure.code} message={failure.message} />;
  }
  const item = actionFailureItem(failure, '', engineOrigin);
  return item.content === undefined || item.content === '' ? item.header : item.content;
}

/** "Topic not found", as the topic's page shows it, in the place of the form. */
function NotFound() {
  const handleFollow = useFollow();
  return (
    <Container>
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            Topic not found
          </Box>
          <Box variant="p" color="inherit">
            The emulator holds no topic with this ARN.
          </Box>
          <Link href={TOPICS_PATH} onFollow={handleFollow}>
            View topics
          </Link>
        </SpaceBetween>
      </Box>
    </Container>
  );
}

/**
 * `/aws/sns/topics/topic/{arn}/subscribe`. The topic is read on opening ("Topic not found" when the emulator does not
 * hold it). "Create subscription" checks that an endpoint is chosen, reads a queue's ARN (`GetQueueAttributes`), sends
 * `Subscribe`, then with the choice on adds what lets the topic deliver; the topic's page opens with the result.
 */
export function CreateSubscriptionPage({ connection, params }: ScreenPageProps) {
  useShowsResources('topics');
  const arn = params['arn'] ?? '';
  const name = topicName(arn);
  const engineOrigin = connection.engineOrigin;
  const navigate = useNavigate();
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
  const topic = useTopic(engineOrigin, arn);
  const readQueue = useReadQueue(engineOrigin);
  const subscribe = useSubscribe(engineOrigin);
  const allowDelivery = useAllowDelivery(engineOrigin);

  const [form, setForm] = useState<SubscribeForm>(START);
  const [tried, setTried] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<FlashItem>();
  const busy = useRef(false);

  const endpointRef = useRef<SelectProps.Ref>(null);
  const failureRef = useRef<AlertProps.Ref>(null);

  // A failure takes the focus when it is shown, so a screen reader reads it at once.
  useEffect(() => {
    if (failure !== undefined) {
      failureRef.current?.focus();
    }
  }, [failure]);

  const endpointError = tried && form.endpoint === undefined ? CHOOSE[form.protocol] : undefined;

  /** The result on the topic's page: subscribed, and, when the policy was left, why. */
  const resultOf = (endpointName: string, left: ReactNode): FlashItem => {
    const subscribed = `Subscribed ${endpointName} to ${name}.`;
    return left === undefined
      ? { type: 'success', content: subscribed }
      : {
          type: 'warning',
          content: (
            <>
              {subscribed} Its policy was not changed: {left}
            </>
          ),
        };
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current) {
      return;
    }
    setTried(true);
    setFailure(undefined);
    const { protocol, endpoint, allow } = form;
    if (endpoint === undefined) {
      endpointRef.current?.focus();
      return;
    }
    if (engineOrigin === undefined) {
      setFailure(
        actionFailureItem(
          { kind: 'engine-did-not-answer', operation: OPERATIONS.subscribe },
          CREATE_SUBSCRIPTION_TITLE,
          undefined,
        ),
      );
      return;
    }
    busy.current = true;
    setPending(true);
    const signal = pageSignal();
    const stop = (item: FlashItem) => {
      busy.current = false;
      setPending(false);
      setFailure(item);
    };

    // The endpoint's ARN: a queue's read at its URL, a function's as `ListFunctions` gave it.
    let endpointArn: string;
    if (endpoint.protocol === 'sqs') {
      try {
        const queue = await readQueue(endpoint.url, signal);
        if (signal.aborted) {
          return;
        }
        if (queue === NOT_FOUND || queue.arn === undefined) {
          stop({ type: 'error', header: `${CREATE_SUBSCRIPTION_TITLE} failed`, content: QUEUE_GONE });
          return;
        }
        endpointArn = queue.arn;
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        stop(
          actionFailureItem(
            failureOf(error, OPERATIONS.getQueueAttributes),
            `Reading the queue ${endpoint.name}`,
            engineOrigin,
          ),
        );
        return;
      }
    } else {
      endpointArn = endpoint.arn;
    }

    try {
      await subscribe({ topicArn: arn, protocol, endpoint: endpointArn }, signal);
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      stop(actionFailureItem(failureOf(error, OPERATIONS.subscribe), CREATE_SUBSCRIPTION_TITLE, engineOrigin));
      return;
    }
    if (signal.aborted) {
      return;
    }

    // Why the policy was left as it was, when it was; `undefined` when it was added, already allowed or not asked.
    let left: ReactNode;
    if (allow) {
      try {
        const outcome: AllowOutcome = await allowDelivery(
          {
            topicArn: arn,
            protocol,
            endpoint: endpointArn,
            ...(endpoint.protocol === 'sqs' ? { queueUrl: endpoint.url } : {}),
          },
          signal,
        );
        if (outcome.outcome === 'not-changed') {
          left = `${outcome.reason}.`;
        }
      } catch (error) {
        left = failureReason(
          failureOf(error, protocol === 'sqs' ? OPERATIONS.setQueueAttributes : OPERATIONS.addPermission),
          engineOrigin,
        );
      }
      if (signal.aborted) {
        return;
      }
    }
    flash.handOver(topicHref(arn), [resultOf(endpoint.name, left)]);
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
    void navigate(topicHref(arn));
  };
  const handleDiscardAnswer = useCallback(
    (answer: DiscardAnswer) => {
      setAsking(false);
      if (answer === 'discard') {
        void navigate(topicHref(arn));
      } else {
        setKept((count) => count + 1);
      }
    },
    [navigate, arn],
  );

  const read = topic.value;
  const topicFailure = topic.failure === undefined ? undefined : readFailureState(topic.failure, connection, 'topic');
  let content: ReactNode;
  if (topicFailure !== undefined) {
    content = (
      <Container>
        <ReadFailure state={topicFailure} onRetry={topic.refresh} />
      </Container>
    );
  } else if (read === undefined) {
    content = (
      <Container>
        <Box textAlign="center" color="inherit">
          <StatusIndicator type="loading">Loading topic</StatusIndicator>
        </Box>
      </Container>
    );
  } else if (!read.found) {
    content = <NotFound />;
  } else {
    content = (
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Form
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button ref={cancelRef} variant="link" formAction="none" onClick={handleCancel}>
                Cancel
              </Button>
              <Button variant="primary" loading={pending} loadingText={SUBSCRIBING}>
                {CREATE_SUBSCRIPTION_TITLE}
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Endpoint</Header>}>
              <SpaceBetween size="l">
                <FormField label="Protocol">
                  <Tiles
                    value={form.protocol}
                    items={PROTOCOL_ITEMS}
                    onChange={({ detail }) => {
                      const protocol = detail.value as DeliveryProtocol;
                      if (protocol !== form.protocol) {
                        // A queue chosen is no function, nor the other way: the choice starts again.
                        setForm((current) => ({ ...current, protocol, endpoint: undefined }));
                      }
                    }}
                  />
                </FormField>
                <EndpointSelect
                  engineOrigin={engineOrigin}
                  connection={connection}
                  protocol={form.protocol}
                  value={form.endpoint}
                  errorText={endpointError}
                  selectRef={endpointRef}
                  onChange={(endpoint) => {
                    setForm((current) => ({ ...current, endpoint }));
                  }}
                />
                <Checkbox
                  checked={form.allow}
                  description={ALLOW_DESCRIPTION[form.protocol]}
                  onChange={({ detail }) => {
                    setForm((current) => ({ ...current, allow: detail.checked }));
                  }}
                >
                  Allow this topic to deliver to it
                </Checkbox>
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
    );
  }

  return (
    <SpaceBetween size="l">
      <Header variant="h1" description={`Subscribes a queue or a function to ${name}.`}>
        {CREATE_SUBSCRIPTION_TITLE}
      </Header>
      {content}
      {/* Mounted only while it asks, so nothing of it is in the page before "Cancel" is pressed. */}
      {asking && <DiscardDialog visible onAnswer={handleDiscardAnswer} />}
    </SpaceBetween>
  );
}
