import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { DiscardDialog, type DiscardAnswer } from '../../../components/discard-dialog';
import { actionFailureItem } from '../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { failureOf } from '../../../components/use-token-listing';
import type { ScreenPageProps } from '../../../screens';
import { CREATE_INTERNET_GATEWAY_TITLE, INTERNET_GATEWAYS_WORD, internetGatewaysHref, VPC_QUERY } from '../format';
import { NAME_CONSTRAINT, nameMessage } from '../form';
import { GATEWAY_CHANGE_OPERATIONS } from '../gateway-changes-api';
import { useCreateGateway } from '../gateway-changes';

// S13, "Create internet gateway" (issue 574, design task 3): an optional name, checked before anything is sent; then
// one `CreateInternetGateway`. On 200 the gateways list opens with the result; a refusal stays on the form with the
// emulator's code and message and the name. What is entered lives in this page alone.

const CREATING = 'Creating';

/**
 * `/aws/vpc/internet-gateways/create`. "Create internet gateway" checks the name, then sends `CreateInternetGateway`;
 * on success the gateways list opens with "Created internet gateway {id}". A failure stays on the form with what was
 * entered, and takes the focus.
 */
export function CreateGatewayPage({ connection }: ScreenPageProps) {
  // Opened from a VPC's way to its gateway (`?vpc={id}`), the way back to S12 keeps that VPC.
  const [query] = useSearchParams();
  const [back] = useState(() => {
    const value = query.get(VPC_QUERY);
    return internetGatewaysHref(value === null || value === '' ? undefined : value);
  });
  useShowsResources(INTERNET_GATEWAYS_WORD);
  const navigate = useNavigate();
  const flash = usePageFlash();
  const engineOrigin = connection.engineOrigin;
  const create = useCreateGateway(engineOrigin);

  const [name, setName] = useState('');
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<FlashItem>();
  const [pending, setPending] = useState(false);

  const nameRef = useRef<InputProps.Ref>(null);
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

  const message = tried ? nameMessage(name) : undefined;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current) {
      return;
    }
    setTried(true);
    setFailure(undefined);
    if (nameMessage(name) !== undefined) {
      nameRef.current?.focus();
      return;
    }
    const operation = GATEWAY_CHANGE_OPERATIONS.createInternetGateway;
    const what = 'Creating internet gateway';
    if (engineOrigin === undefined) {
      setFailure(actionFailureItem({ kind: 'engine-did-not-answer', operation }, what, undefined));
      return;
    }
    busy.current = true;
    setPending(true);
    const controller = new AbortController();
    inFlight.current = controller;
    const settle = () => {
      inFlight.current = null;
      busy.current = false;
      setPending(false);
    };
    try {
      const id = await create(name === '' ? {} : { name }, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      settle();
      flash.handOver(back, [{ type: 'success', content: `Created internet gateway ${id}` }]);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      settle();
      setFailure(actionFailureItem(failureOf(error, operation), what, engineOrigin));
    }
  };

  // "Cancel" leaves at once while nothing is entered; otherwise it asks (`aws-area.md`, entry 5).
  const [asking, setAsking] = useState(false);
  const cancelRef = useRef<ButtonProps.Ref>(null);
  const [kept, setKept] = useState(0);
  useEffect(() => {
    if (kept > 0) {
      cancelRef.current?.focus();
    }
  }, [kept]);
  const handleCancel = () => {
    if (name !== '') {
      setAsking(true);
      return;
    }
    void navigate(back);
  };
  const handleDiscardAnswer = useCallback(
    (answer: DiscardAnswer) => {
      setAsking(false);
      if (answer === 'discard') {
        void navigate(back);
      } else {
        setKept((count) => count + 1);
      }
    },
    [navigate, back],
  );

  return (
    <SpaceBetween size="l">
      <Header variant="h1">{CREATE_INTERNET_GATEWAY_TITLE}</Header>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Form
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button ref={cancelRef} variant="link" formAction="none" onClick={handleCancel}>
                Cancel
              </Button>
              <Button variant="primary" loading={pending} loadingText={CREATING}>
                {pending ? CREATING : CREATE_INTERNET_GATEWAY_TITLE}
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Internet gateway</Header>}>
              <FormField label="Name - optional" constraintText={NAME_CONSTRAINT} errorText={message}>
                <Input
                  ref={nameRef}
                  value={name}
                  invalid={message !== undefined}
                  autoComplete={false}
                  spellcheck={false}
                  onChange={({ detail }) => {
                    setName(detail.value);
                  }}
                />
              </FormField>
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
