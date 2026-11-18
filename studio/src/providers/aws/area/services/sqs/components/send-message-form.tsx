import AttributeEditor from '@cloudscape-design/components/attribute-editor';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import { useState, type FormEvent } from 'react';

import type { OutgoingMessage } from '../api';
import type { QueueSettings } from '../format';
import {
  EMPTY_SEND_FORM,
  MAX_ATTRIBUTES,
  outgoing,
  refuses,
  sendFormMessages,
  type AttributeRow,
  type AttributeType,
  type SendForm,
  type SendFormMessages,
} from './send-form';

// S2's tab "Send message" (issue 481, design task 3): a test message's body, delay or FIFO ids, and up to 10 message
// attributes. Every rule the emulator enforces (probe-2 §4, issue 79 probe-2 §5) is checked before anything is sent;
// the form keeps its values after a send, so the same message can be sent again, and "Clear" empties it.

const TYPES: readonly SelectProps.Option[] = [
  { value: 'String', label: 'String' },
  { value: 'Number', label: 'Number' },
  { value: 'Binary', label: 'Binary' },
];

const MIB = 1024 * 1024;

/** "Up to 1,048,576 bytes (1 MiB).": the number grouped, and in MiB when it is a whole number of them. */
function sizeRule(max: number): string {
  const bytes = max.toLocaleString('en-US');
  return max > 0 && max % MIB === 0 ? `Up to ${bytes} bytes (${String(max / MIB)} MiB).` : `Up to ${bytes} bytes.`;
}

export interface SendMessageFormProps {
  settings: QueueSettings;
  form: SendForm;
  onChange: (form: SendForm) => void;
  sending: boolean;
  onSend: (message: OutgoingMessage) => void;
}

export function SendMessageForm({ settings, form, onChange, sending, onSend }: SendMessageFormProps) {
  // The refusals are shown once "Send" has been pressed, and follow what is typed after.
  const [tried, setTried] = useState(false);
  const messages: SendFormMessages = tried ? sendFormMessages(form, settings) : { attributes: [] };
  const full = form.attributes.length >= MAX_ATTRIBUTES;

  const change = (next: Partial<SendForm>) => {
    onChange({ ...form, ...next });
  };
  const changeRow = (index: number, next: Partial<AttributeRow>) => {
    change({ attributes: form.attributes.map((row, at) => (at === index ? { ...row, ...next } : row)) });
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (sending) {
      return;
    }
    setTried(true);
    if (!refuses(sendFormMessages(form, settings))) {
      onSend(outgoing(form, settings));
    }
  };

  const handleClear = () => {
    setTried(false);
    onChange(EMPTY_SEND_FORM);
  };

  const max = settings.maximumMessageSize;
  return (
    <form onSubmit={handleSubmit} noValidate>
      <Form
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button formAction="none" variant="link" disabled={sending} onClick={handleClear}>
              Clear
            </Button>
            <Button formAction="submit" variant="primary" loading={sending} disabled={sending}>
              Send
            </Button>
          </SpaceBetween>
        }
      >
        <Container header={<Header variant="h2">Send a test message</Header>}>
          <SpaceBetween size="l">
            <FormField
              label="Body"
              {...(max === undefined ? {} : { constraintText: sizeRule(max) })}
              errorText={messages.body}
              stretch
            >
              <Textarea
                value={form.body}
                rows={6}
                onChange={({ detail }) => {
                  change({ body: detail.value });
                }}
              />
            </FormField>
            {/* Each field a child of its own, so the form's spacing applies between them. */}
            {settings.fifo && (
              <FormField label="Group ID" errorText={messages.groupId}>
                <Input
                  value={form.groupId}
                  onChange={({ detail }) => {
                    change({ groupId: detail.value });
                  }}
                />
              </FormField>
            )}
            {settings.fifo && (
              <FormField
                label={settings.contentBasedDeduplication ? 'Deduplication ID - optional' : 'Deduplication ID'}
                {...(settings.contentBasedDeduplication
                  ? { description: 'Leave empty to deduplicate by the body.' }
                  : {})}
                errorText={messages.deduplicationId}
              >
                <Input
                  value={form.deduplicationId}
                  onChange={({ detail }) => {
                    change({ deduplicationId: detail.value });
                  }}
                />
              </FormField>
            )}
            {!settings.fifo && (
              <FormField label="Delay" constraintText="0 to 900 seconds." errorText={messages.delay}>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={form.delay}
                  onChange={({ detail }) => {
                    change({ delay: detail.value });
                  }}
                />
              </FormField>
            )}
            <FormField label="Message attributes - optional" stretch>
              <AttributeEditor<AttributeRow>
                items={form.attributes}
                addButtonText="Add attribute"
                removeButtonText="Remove"
                disableAddButton={full}
                additionalInfo={`Up to ${String(MAX_ATTRIBUTES)} attributes.`}
                empty="No message attributes."
                onAddButtonClick={() => {
                  if (!full) {
                    change({ attributes: [...form.attributes, { name: '', type: 'String', value: '' }] });
                  }
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
                        onChange={({ detail }) => {
                          changeRow(index, { name: detail.value });
                        }}
                      />
                    ),
                    errorText: (_, index) => messages.attributes[index]?.name,
                  },
                  {
                    label: 'Type',
                    control: (row, index) => (
                      <Select
                        selectedOption={TYPES.find((option) => option.value === row.type) ?? null}
                        options={[...TYPES]}
                        ariaLabel={`Type of attribute ${String(index + 1)}`}
                        onChange={({ detail }) => {
                          changeRow(index, { type: (detail.selectedOption.value ?? 'String') as AttributeType });
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
                        {...(row.type === 'Binary' ? { placeholder: 'Base64 text' } : {})}
                        onChange={({ detail }) => {
                          changeRow(index, { value: detail.value });
                        }}
                      />
                    ),
                    errorText: (_, index) => messages.attributes[index]?.value,
                  },
                ]}
              />
            </FormField>
          </SpaceBetween>
        </Container>
      </Form>
    </form>
  );
}
