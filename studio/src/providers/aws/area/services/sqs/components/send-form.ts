import type { OutgoingAttribute, OutgoingMessage } from '../api';
import { base64ToBytes, type QueueSettings } from '../format';

// The rules of S2's send form (issue 481, design task 3): what the emulator refused (probe-2 §4, issue 79 probe-2 §5)
// is refused here before anything is sent, and the message is built with no field sent empty.

/** The most message attributes a message takes (the emulator refused 11). */
export const MAX_ATTRIBUTES = 10;

/** The longest per-message delay, in seconds. */
export const MAX_DELAY_SECONDS = 900;

export type AttributeType = OutgoingAttribute['type'];

/** One row of the attribute editor, as typed. */
export interface AttributeRow {
  name: string;
  type: AttributeType;
  value: string;
}

/** The form's values, as typed. */
export interface SendForm {
  body: string;
  delay: string;
  groupId: string;
  deduplicationId: string;
  attributes: AttributeRow[];
}

export const EMPTY_SEND_FORM: SendForm = { body: '', delay: '0', groupId: '', deduplicationId: '', attributes: [] };

/** What the form says of a row it refuses. */
interface RowMessages {
  name?: string;
  value?: string;
}

/** What the form says of each field it refuses; empty when it can be sent. */
export interface SendFormMessages {
  body?: string;
  delay?: string;
  groupId?: string;
  deduplicationId?: string;
  attributes: RowMessages[];
}

/** An SQS Number: digits with an optional sign, decimal point and exponent. */
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** The form's refusals of `form` for a queue of `settings`. */
export function sendFormMessages(form: SendForm, settings: QueueSettings): SendFormMessages {
  const messages: SendFormMessages = { attributes: [] };
  const max = settings.maximumMessageSize;
  if (form.body === '') {
    messages.body = 'Enter a body.';
  } else if (max !== undefined && byteLength(form.body) > max) {
    messages.body = `The body is ${String(byteLength(form.body))} bytes; this queue takes up to ${String(max)} bytes.`;
  }
  if (settings.fifo) {
    if (form.groupId === '') {
      messages.groupId = 'Enter a group ID.';
    }
    if (form.deduplicationId === '' && !settings.contentBasedDeduplication) {
      messages.deduplicationId = 'Enter a deduplication ID.';
    }
  } else if (form.delay !== '' && !(/^\d+$/.test(form.delay) && Number(form.delay) <= MAX_DELAY_SECONDS)) {
    messages.delay = `Enter a whole number of seconds from 0 to ${String(MAX_DELAY_SECONDS)}.`;
  }
  messages.attributes = form.attributes.map((row) => {
    const own: RowMessages = {};
    if (row.name === '') {
      own.name = 'Enter a name.';
    } else if (form.attributes.filter((other) => other.name === row.name).length > 1) {
      own.name = 'Each attribute needs a name of its own.';
    }
    if (row.value === '') {
      own.value = 'Enter a value.';
    } else if (row.type === 'Number' && !NUMBER.test(row.value)) {
      own.value = 'Enter a number.';
    } else if (row.type === 'Binary' && base64ToBytes(row.value) === undefined) {
      own.value = 'Enter the value as Base64 text.';
    }
    return own;
  });
  return messages;
}

export function refuses(messages: SendFormMessages): boolean {
  return (
    messages.body !== undefined ||
    messages.delay !== undefined ||
    messages.groupId !== undefined ||
    messages.deduplicationId !== undefined ||
    messages.attributes.some((row) => row.name !== undefined || row.value !== undefined)
  );
}

/** The message `form` sends; no field is sent empty. */
export function outgoing(form: SendForm, settings: QueueSettings): OutgoingMessage {
  const message: OutgoingMessage = {
    body: form.body,
    attributes: form.attributes.map(({ name, type, value }) => ({ name, type, value })),
  };
  if (settings.fifo) {
    message.groupId = form.groupId;
    if (form.deduplicationId !== '') {
      message.deduplicationId = form.deduplicationId;
    }
  } else if (form.delay !== '') {
    message.delaySeconds = Number(form.delay);
  }
  return message;
}
