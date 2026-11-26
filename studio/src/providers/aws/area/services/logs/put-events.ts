import type { InputLogEvent, RejectedLogEventsInfo } from '@aws-sdk/client-cloudwatch-logs';

const MAX_BATCH_BYTES = 1_048_576;
const EVENT_OVERHEAD_BYTES = 26;
const encoder = new TextEncoder();

export const PUT_EVENTS_SIZE_RULE =
  'Each message counts as its UTF-8 bytes plus 26 bytes. The batch can be at most 1,048,576 bytes.';
export const EMPTY_MESSAGE_ERROR = 'Enter a message.';

export function validateMessages(messages: readonly string[]) {
  const bytes = messages.reduce(
    (total, message) => total + encoder.encode(message).byteLength + EVENT_OVERHEAD_BYTES,
    0,
  );
  return {
    messageErrors: messages.map((message) => (message === '' ? EMPTY_MESSAGE_ERROR : undefined)),
    batchError: bytes > MAX_BATCH_BYTES ? 'The batch is larger than 1,048,576 bytes.' : undefined,
  };
}

export function eventsAt(messages: readonly string[], timestamp: number): InputLogEvent[] {
  return messages.map((message) => ({ message, timestamp }));
}

export function putEventCounts(sent: number, bounds: RejectedLogEventsInfo | undefined) {
  const firstStored = Math.max(bounds?.tooOldLogEventEndIndex ?? 0, bounds?.expiredLogEventEndIndex ?? 0);
  const endStored = bounds?.tooNewLogEventStartIndex ?? sent;
  const stored = Math.max(0, endStored - firstStored);
  return { stored, rejected: sent - stored };
}
