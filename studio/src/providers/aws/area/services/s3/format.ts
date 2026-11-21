import { AWS_PATH } from '../../../identity';
import { functionPath, queuePath } from '../../components/resource-paths';

// The routes of S3's screens and the words S3's values are shown in (issue 56, requirement R6; issue 256,
// requirement R0, R5.3, R10). Creation dates are written by the area's shared `components/format-date.ts`
// (issue 386, R7).

/** S3's route in the area, `/aws/s3`. */
export const S3_PATH = `${AWS_PATH}/s3`;

/** The general purpose bucket list. */
export const BUCKETS_PATH = `${S3_PATH}/buckets`;

/** "Create bucket". */
export const CREATE_BUCKET_PATH = `${S3_PATH}/bucket/create`;

/** A bucket's name as one path segment: percent-encoded, so a space, "%" or "/" cannot change the route. */
function segment(name: string): string {
  return encodeURIComponent(name);
}

/** A bucket's own page, the link of its name. */
export function bucketPath(name: string): string {
  return `${BUCKETS_PATH}/${segment(name)}`;
}

/** `?<name>=<value>` for a value that is not empty, encoded by `URLSearchParams` so any key round-trips; else none. */
function query(name: string, value: string): string {
  return value === '' ? '' : `?${new URLSearchParams({ [name]: value }).toString()}`;
}

/**
 * A bucket's tab "Objects" at `prefix` (issue 480): the bucket's own route, the prefix in the query, never in a path
 * segment, since a key holds `/`, `?`, `#` and `%`.
 */
export function objectsPath(name: string, prefix = ''): string {
  return `${bucketPath(name)}${query('prefix', prefix)}`;
}

/** An object's own page (issue 480, task 2), its key in the query. */
export function objectPath(name: string, key: string): string {
  return `${bucketPath(name)}/object?${new URLSearchParams({ key }).toString()}`;
}

/** "Upload" into `prefix` of a bucket (issue 480, task 3). */
export function uploadPath(name: string, prefix = ''): string {
  return `${S3_PATH}/bucket/${segment(name)}/upload${query('prefix', prefix)}`;
}

/** The tab "Properties" of a bucket's page. */
export function bucketPropertiesPath(name: string): string {
  return `${bucketPath(name)}/properties`;
}

/** The sections of a bucket's "Properties" whose button is "Edit" (R10). */
export type EditableProperty = 'versioning' | 'tags' | 'encryption' | 'website';

/** The route of a section's "Edit". */
export function editPropertyPath(name: string, property: EditableProperty): string {
  return `${S3_PATH}/bucket/${segment(name)}/property/${property}/edit`;
}

/** "Create event notification" of "Event notifications". */
export function createEventNotificationPath(name: string): string {
  return `${S3_PATH}/bucket/${segment(name)}/property/event-notification/create`;
}

export function editEventNotificationPath(name: string, id: string): string {
  return `${S3_PATH}/bucket/${segment(name)}/property/event-notification/~${segment(id)}/edit`;
}

/** The area has already decoded the segment once. The marker also protects dot-segment IDs. */
export function eventNotificationId(segmentValue: string | undefined): string | undefined {
  return segmentValue?.startsWith('~') ? segmentValue.slice(1) : undefined;
}

const QUEUE_ARN = /^arn:aws(?:-[a-z0-9-]+)?:sqs:[a-z0-9-]+:\d{12}:([A-Za-z0-9_-]{1,80}(?:\.fifo)?)$/;
const FUNCTION_ARN =
  /^arn:aws(?:-[a-z0-9-]+)?:lambda:[a-z0-9-]+:\d{12}:function:([A-Za-z0-9_-]{1,64})(?::[A-Za-z0-9_$-]+)?$/;

export function notificationDestinationPath(type: string, arn: string | undefined): string | undefined {
  if (arn === undefined) return undefined;
  if (type === 'SQS queue') {
    const name = QUEUE_ARN.exec(arn)?.[1];
    return name === undefined ? undefined : queuePath(name);
  }
  if (type === 'Lambda function') {
    const name = FUNCTION_ARN.exec(arn)?.[1];
    return name === undefined ? undefined : `${functionPath(name)}?tab=monitor`;
  }
  return undefined;
}

/** "Empty" for a bucket. */
export function emptyBucketPath(name: string): string {
  return `${S3_PATH}/bucket/${segment(name)}/empty`;
}

/** "Delete" for a bucket. */
export function deleteBucketPath(name: string): string {
  return `${S3_PATH}/bucket/${segment(name)}/delete`;
}

/** The console's names of the three encryption types, by the algorithm the API names them with (R5.3). */
const ENCRYPTION_TYPES: Readonly<Record<string, string>> = {
  AES256: 'Server-side encryption with Amazon S3 managed keys (SSE-S3)',
  'aws:kms': 'Server-side encryption with AWS Key Management Service keys (SSE-KMS)',
  'aws:kms:dsse': 'Dual-layer server-side encryption with AWS Key Management Service (AWS KMS) keys (DSSE-KMS)',
};

/** "Encryption type" for a default encryption's algorithm; an algorithm of no type here as it came. */
export function encryptionTypeLabel(algorithm: string): string {
  return Object.hasOwn(ENCRYPTION_TYPES, algorithm) ? (ENCRYPTION_TYPES[algorithm] as string) : algorithm;
}

/** The Type of a folder row of the tab "Objects". */
export const FOLDER_TYPE = 'Folder';

/** A value a row lacks: a folder's size and storage class, a key without an extension. */
export const NO_VALUE = '-';

/** The Type of an object row: the last extension of the key's last part ("json"), or "-" for a key without one. */
export function keyType(key: string): string {
  const last = key.slice(key.lastIndexOf('/') + 1);
  const dot = last.lastIndexOf('.');
  // A name that starts with its only dot (".env") or ends in one has no extension.
  return dot <= 0 || dot === last.length - 1 ? NO_VALUE : last.slice(dot + 1);
}

const SIZE_UNITS = ['KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const;

/** A size in bytes, base 1024: "512 B" under 1024 bytes, then one decimal ("1.5 KiB", "20.0 MiB", "1.2 GiB"). */
export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }
  let value = bytes / 1024;
  let unit = 0;
  // Moved up while the value would show as 1024.0 or more of its unit.
  while (Number(value.toFixed(1)) >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${SIZE_UNITS[unit] as string}`;
}

/** One part of a prefix's trail: its text and the prefix it opens. */
export interface PrefixPart {
  text: string;
  prefix: string;
}

/**
 * The parts of `prefix`, from the root down (`logs/2026/` → `logs` at `logs/`, `2026` at `logs/2026/`): each ends at a
 * `/`; a last part without one is the prefix as it was given. An empty part (of `d//`) is shown as "/".
 */
export function prefixParts(prefix: string): PrefixPart[] {
  const parts: PrefixPart[] = [];
  let start = 0;
  while (start < prefix.length) {
    const slash = prefix.indexOf('/', start);
    const end = slash === -1 ? prefix.length : slash + 1;
    const text = prefix.slice(start, slash === -1 ? prefix.length : slash);
    parts.push({ text: text === '' ? '/' : text, prefix: prefix.slice(0, end) });
    start = end;
  }
  return parts;
}

/** An object's or a folder's S3 URI, `s3://{name}/{key}`, the key exactly as the emulator gave it. */
export function s3Uri(name: string, key: string): string {
  return `s3://${name}/${key}`;
}

/**
 * The folder an object's key is in (issue 480, task 2): its part up to its last `/` (`logs/2026/x.json` → `logs/2026/`);
 * for a key that ends in `/` (a folder's marker), the folder that holds it (`a/b/` → `a/`).
 */
export function keyPrefix(key: string): string {
  const own = key.endsWith('/') ? key.slice(0, -1) : key;
  return own.slice(0, own.lastIndexOf('/') + 1);
}

/** An object's name on its page: the key's last part, or the whole key for a key that ends in `/`. */
export function keyName(key: string): string {
  return key.endsWith('/') ? key : key.slice(key.lastIndexOf('/') + 1);
}

/** An object's ARN, `arn:aws:s3:::{name}/{key}`. */
export function objectArn(name: string, key: string): string {
  return `arn:aws:s3:::${name}/${key}`;
}
