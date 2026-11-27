import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Textarea, { type TextareaProps } from '@cloudscape-design/components/textarea';
import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { useSearchParams } from 'react-router';

import { actionFailureItem, CodeAndMessage } from '../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { BUS_OPERATIONS, getEventBus } from '../bus-api';
import { BusSelect } from '../components/bus-select';
import { PUT_EVENTS, putEvent } from '../send-api';
import { DETAIL_CONSTRAINT, INITIAL_SEND_FORM, sendEntry, SOURCE_CONSTRAINT, validateSendForm } from '../send-form';
import { useBusChoice, type BusChoice } from '../use-bus-choice';

const DESCRIPTION =
  "The bus's enabled rules whose pattern matches route the event to their targets. A target receives it only if it allows EventBridge to deliver. The event ID says the emulator accepted the event, not that a rule matched or a target received it.";

type ConnectionProps = Pick<ScreenPageProps, 'connection'>;

export function SendEventsPage({ connection }: ConnectionProps) {
  useShowsResources('event buses');
  const [search] = useSearchParams();
  const addressBus = search.get('bus');
  return <SendFormPage key={addressBus ?? undefined} addressBus={addressBus} connection={connection} />;
}

function SendFormPage({ connection, addressBus }: ConnectionProps & { addressBus: string | null }) {
  const { engineOrigin } = connection;
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
  const [selectedBus, setSelectedBus] = useState<string>();
  const resolvedBus = useBusChoice(engineOrigin, selectedBus ?? addressBus, selectedBus);
  const [missingBus, setMissingBus] = useState<Extract<BusChoice, { kind: 'invalid' }>>();
  const choice = missingBus ?? resolvedBus;
  const [form, setForm] = useState(INITIAL_SEND_FORM);
  const [tried, setTried] = useState(false);
  const [pending, setPending] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [receipt, setReceipt] = useState<ReactElement>();
  const [notice, setNotice] = useState<FlashItem>();
  const receiptRef = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const sourceInput = useRef<InputProps.Ref>(null);
  const typeInput = useRef<InputProps.Ref>(null);
  const detailInput = useRef<TextareaProps.Ref>(null);
  const errors = tried ? validateSendForm(form) : {};

  useEffect(() => {
    const element = receiptRef.current;
    if (!receipt || !element) return;
    const { top, bottom } = element.getBoundingClientRect();
    if (top < 0 || bottom > window.innerHeight) {
      element.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    }
  }, [receipt]);

  function handleBusChange(name: string) {
    if (busy.current) return;
    setSelectedBus(name);
    setMissingBus(undefined);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy.current || unavailable) return;

    setTried(true);
    setNotice(undefined);
    setReceipt(undefined);
    const faults = validateSendForm(form);
    if (choice.kind !== 'chosen') return;
    if (faults.source !== undefined) return sourceInput.current?.focus();
    if (faults.detailType !== undefined) return typeInput.current?.focus();
    if (faults.detail !== undefined) return detailInput.current?.focus();

    const bus = choice.name;
    let operation: string = BUS_OPERATIONS.describeEventBus;
    if (engineOrigin === undefined) {
      setNotice({
        ...actionFailureItem({ kind: 'engine-did-not-answer', operation }, operation, engineOrigin),
        content: `${operation} failed.`,
      });
      return;
    }

    busy.current = true;
    setPending(true);
    const signal = pageSignal();
    try {
      const read = await getEventBus(engineOrigin, bus, signal);
      if (signal.aborted) return;
      if (read.kind !== 'found' || read.bus.Name !== bus) {
        setMissingBus({
          kind: 'invalid',
          name: bus,
          message: `Event bus ${bus} is not in your local emulator. Choose an event bus.`,
        });
        return;
      }
      operation = PUT_EVENTS;
      const result = await putEvent(engineOrigin, sendEntry(bus, form), signal);
      if (signal.aborted) return;
      if (result.kind === 'refused') {
        setNotice({
          type: 'error',
          content: (
            <>
              The emulator did not accept the event: <CodeAndMessage code={result.code} message={result.message} />
            </>
          ),
        });
        return;
      }
      const accepted = (
        <>
          The emulator accepted the event for <ValueText kind="name" value={bus} />. Event ID{' '}
          <ValueText kind="name" value={result.id} />.
        </>
      );
      setReceipt(accepted);
      flash.show([{ type: 'success', content: accepted }]);
    } catch (error) {
      if (signal.aborted) return;
      const failure = failureOf(error, operation);
      const item = actionFailureItem(failure, failure.operation, engineOrigin);
      setUnavailable(failure.kind === 'not-implemented' && operation === PUT_EVENTS);
      setNotice(
        failure.kind === 'engine-did-not-answer' || failure.kind === 'emulator-did-not-answer'
          ? {
              ...item,
              content: (
                <>
                  {failure.operation} failed. {item.content}
                </>
              ),
            }
          : item,
      );
    } finally {
      if (!signal.aborted) {
        busy.current = false;
        setPending(false);
      }
    }
  }

  return (
    <ContentLayout
      header={
        <Header variant="h1" description={DESCRIPTION}>
          Send events
        </Header>
      }
    >
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Form
          actions={
            <SpaceBetween size="xs">
              {receipt && (
                // The area's flash announces the receipt. This copy stays beside Send for sighted users.
                <div ref={receiptRef} aria-hidden="true">
                  <StatusIndicator type="success">{receipt}</StatusIndicator>
                </div>
              )}
              <Button
                formAction="submit"
                variant="primary"
                disabled={unavailable}
                loading={pending}
                loadingText="Sending"
              >
                Send
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Event details</Header>}>
              <SpaceBetween size="l">
                <BusSelect connection={connection} choice={choice} onChange={handleBusChange} />
                <FormField label="Source" constraintText={SOURCE_CONSTRAINT} errorText={errors.source}>
                  <Input
                    ref={sourceInput}
                    ariaRequired
                    value={form.source}
                    invalid={errors.source !== undefined}
                    disabled={pending}
                    onChange={({ detail }) => setForm((current) => ({ ...current, source: detail.value }))}
                  />
                </FormField>
                <FormField label="Detail type" errorText={errors.detailType}>
                  <Input
                    ref={typeInput}
                    ariaRequired
                    value={form.detailType}
                    invalid={errors.detailType !== undefined}
                    disabled={pending}
                    onChange={({ detail }) => setForm((current) => ({ ...current, detailType: detail.value }))}
                  />
                </FormField>
                <FormField label="Detail" constraintText={DETAIL_CONSTRAINT} errorText={errors.detail} stretch>
                  <Textarea
                    ref={detailInput}
                    ariaRequired
                    value={form.detail}
                    rows={6}
                    invalid={errors.detail !== undefined}
                    disabled={pending}
                    onChange={({ detail }) => setForm((current) => ({ ...current, detail: detail.value }))}
                  />
                </FormField>
              </SpaceBetween>
            </Container>
            {notice && (
              <Alert type={notice.type} header={notice.header}>
                {notice.content}
              </Alert>
            )}
          </SpaceBetween>
        </Form>
      </form>
    </ContentLayout>
  );
}
