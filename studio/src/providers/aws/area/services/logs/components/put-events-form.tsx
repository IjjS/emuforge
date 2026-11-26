import Alert from '@cloudscape-design/components/alert';
import AttributeEditor from '@cloudscape-design/components/attribute-editor';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import { useState } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { AreaModal } from '../../../components/area-modal';
import { actionFailureItem } from '../../../components/failure-states';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { eventsAt, PUT_EVENTS_SIZE_RULE, putEventCounts, validateMessages } from '../put-events';
import { PUT_LOG_EVENTS, putLogEvents } from '../put-events-api';

interface PutEventsFormProps {
  endpoint: string | undefined;
  group: string;
  stream: string;
  unavailable: boolean;
  onUnavailable: () => void;
  onDismiss: () => void;
  onPut: (time: number, counts: ReturnType<typeof putEventCounts>) => void;
}

export function PutEventsForm({
  endpoint,
  group,
  stream,
  unavailable,
  onUnavailable,
  onDismiss,
  onPut,
}: PutEventsFormProps) {
  const pageSignal = usePageSignal();
  const [messages, setMessages] = useState(['']);
  const [validate, setValidate] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<RequestFailure>();
  const errors = validate ? validateMessages(messages) : undefined;
  const reason = unavailable ? ({ kind: 'not-implemented', operation: PUT_LOG_EVENTS } as const) : failure;
  const alert = reason && actionFailureItem(reason, PUT_LOG_EVENTS, endpoint);
  const connectionFailure = reason?.kind === 'engine-did-not-answer' || reason?.kind === 'emulator-did-not-answer';

  const dismiss = () => {
    if (!pending) onDismiss();
  };

  async function submit() {
    if (endpoint === undefined || unavailable || pending) return;
    const time = Date.now();
    setValidate(true);
    const { batchError, messageErrors } = errors ?? validateMessages(messages);
    if (batchError !== undefined || messageErrors.some((error) => error !== undefined)) return;

    const signal = pageSignal();
    setPending(true);
    setFailure(undefined);
    try {
      const bounds = await putLogEvents(endpoint, group, stream, eventsAt(messages, time), signal);
      if (!signal.aborted) onPut(time, putEventCounts(messages.length, bounds));
    } catch (error) {
      if (signal.aborted) return;
      const failed = failureOf(error, PUT_LOG_EVENTS);
      if (failed.kind === 'not-implemented') onUnavailable();
      else setFailure(failed);
      setPending(false);
    }
  }

  return (
    <AreaModal
      visible
      header="Put log events"
      closeAriaLabel="Close"
      onDismiss={dismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={pending} onClick={dismiss}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={endpoint === undefined || unavailable}
              loading={pending}
              onClick={() => void submit()}
            >
              Put log events
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <Box variant="p">{PUT_EVENTS_SIZE_RULE}</Box>
        <AttributeEditor
          items={messages}
          addButtonText="Add message"
          removeButtonText="Remove"
          disableAddButton={pending}
          isItemRemovable={() => !pending && messages.length > 1}
          onAddButtonClick={() => setMessages((current) => [...current, ''])}
          onRemoveButtonClick={({ detail }) =>
            setMessages((current) => current.filter((_, index) => index !== detail.itemIndex))
          }
          definition={[
            {
              label: 'Message',
              control: (message, index) => (
                <Textarea
                  value={message}
                  disabled={pending}
                  onChange={({ detail }) =>
                    setMessages((current) => current.map((value, at) => (at === index ? detail.value : value)))
                  }
                />
              ),
              errorText: (_, index) => errors?.messageErrors[index],
            },
          ]}
        />
        {errors?.batchError !== undefined && <Alert type="error">{errors.batchError}</Alert>}
        {alert && (
          <Alert type={alert.type === 'info' ? 'info' : 'error'} header={alert.header}>
            {connectionFailure && <Box variant="p">{PUT_LOG_EVENTS} failed.</Box>}
            {alert.content}
          </Alert>
        )}
      </SpaceBetween>
    </AreaModal>
  );
}
