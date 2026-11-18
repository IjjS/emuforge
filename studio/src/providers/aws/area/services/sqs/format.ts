import { AWS_PATH } from '../../../identity';

// How the SQS screens read a queue's values (issue 481, design tasks 1 to 5), and the routes their controls lead to.
// Every value is the emulator's, as it came: a name is cut from the URL or ARN the emulator returned, never built.

/** Shown for a value the answer lacks. */
export const NONE = '-';

/** SQS's route in the area, `/aws/sqs`. */
export const SQS_PATH = `${AWS_PATH}/sqs`;

/** S1, the queue list. */
export const QUEUES_PATH = `${SQS_PATH}/queues`;

/** S2, a queue's page; its name is one segment below `queue/`. */
export function queuePath(name: string): string {
  return `${QUEUES_PATH}/queue/${encodeURIComponent(name)}`;
}

/** A queue's name: the text after a queue URL's last `/`. */
export function queueNameFromUrl(url: string): string {
  return url.slice(url.lastIndexOf('/') + 1);
}

/** A resource's name: the text after an ARN's last `:`. */
export function nameFromArn(arn: string): string {
  return arn.slice(arn.lastIndexOf(':') + 1);
}

/** A queue's `RedrivePolicy`, as far as the screens show it. */
export interface RedrivePolicy {
  /** `deadLetterTargetArn`, as it came. */
  deadLetterTargetArn: string;
  /** The dead-letter queue's name, from that ARN. */
  deadLetterQueue: string;
  /** `maxReceiveCount`; absent when the policy gave none that is a number. */
  maxReceiveCount?: number;
}

/** What the screens read of `GetQueueAttributes`. A value the answer lacks is absent. */
export interface QueueSettings {
  fifo: boolean;
  /** `ApproximateNumberOfMessages`. */
  available?: number;
  /** `ApproximateNumberOfMessagesNotVisible`. */
  inFlight?: number;
  /** `ApproximateNumberOfMessagesDelayed`. */
  delayed?: number;
  /** `QueueArn`, as it came. */
  arn?: string;
  /** `MaximumMessageSize`, in bytes. */
  maximumMessageSize?: number;
  contentBasedDeduplication: boolean;
  /** Absent without a policy, and when `RedrivePolicy` is not a JSON object naming a dead-letter queue. */
  redrivePolicy?: RedrivePolicy;
}

/** A whole number written as text, else `undefined`. */
export function wholeNumber(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) {
    return undefined;
  }
  return Number(value);
}

function redrivePolicyOf(text: string | undefined): RedrivePolicy | undefined {
  if (text === undefined || text === '') {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }
  const { deadLetterTargetArn, maxReceiveCount } = parsed as Record<string, unknown>;
  if (typeof deadLetterTargetArn !== 'string' || deadLetterTargetArn === '') {
    return undefined;
  }
  const policy: RedrivePolicy = { deadLetterTargetArn, deadLetterQueue: nameFromArn(deadLetterTargetArn) };
  const count =
    typeof maxReceiveCount === 'number' && Number.isInteger(maxReceiveCount)
      ? maxReceiveCount
      : wholeNumber(typeof maxReceiveCount === 'string' ? maxReceiveCount : undefined);
  if (count !== undefined) {
    policy.maxReceiveCount = count;
  }
  return policy;
}

/** The settings and counts of a queue, from the attributes `GetQueueAttributes` returned. */
export function queueSettings(attributes: Readonly<Record<string, string>>): QueueSettings {
  const settings: QueueSettings = {
    fifo: attributes['FifoQueue'] === 'true',
    contentBasedDeduplication: attributes['ContentBasedDeduplication'] === 'true',
  };
  const available = wholeNumber(attributes['ApproximateNumberOfMessages']);
  if (available !== undefined) {
    settings.available = available;
  }
  const inFlight = wholeNumber(attributes['ApproximateNumberOfMessagesNotVisible']);
  if (inFlight !== undefined) {
    settings.inFlight = inFlight;
  }
  const delayed = wholeNumber(attributes['ApproximateNumberOfMessagesDelayed']);
  if (delayed !== undefined) {
    settings.delayed = delayed;
  }
  const arn = attributes['QueueArn'];
  if (arn !== undefined && arn !== '') {
    settings.arn = arn;
  }
  const size = wholeNumber(attributes['MaximumMessageSize']);
  if (size !== undefined) {
    settings.maximumMessageSize = size;
  }
  const policy = redrivePolicyOf(attributes['RedrivePolicy']);
  if (policy !== undefined) {
    settings.redrivePolicy = policy;
  }
  return settings;
}

/** "FIFO" or "Standard". */
export function queueType(settings: Pick<QueueSettings, 'fifo'>): string {
  return settings.fifo ? 'FIFO' : 'Standard';
}

/** A body's first line, and whether more lines follow it. */
export interface BodyPreview {
  first: string;
  more: boolean;
}

/** The first line of `body` (up to its first line break), and whether more follows. */
export function bodyPreview(body: string): BodyPreview {
  const end = body.search(/\r\n|\r|\n/);
  return end === -1 ? { first: body, more: false } : { first: body.slice(0, end), more: true };
}

/** `body` indented, when it parses as JSON; `undefined` when it does not. */
export function formattedJson(body: string): string | undefined {
  try {
    return JSON.stringify(JSON.parse(body) as unknown, null, 2);
  } catch {
    return undefined;
  }
}

/** Bytes as Base64 text. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * The bytes Base64 text `text` stands for; `undefined` for text that is not Base64 (padded, of the standard
 * alphabet), the empty text included, since a Binary attribute holds at least one byte.
 */
export function base64ToBytes(text: string): Uint8Array | undefined {
  if (text === '' || !BASE64.test(text)) {
    return undefined;
  }
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
