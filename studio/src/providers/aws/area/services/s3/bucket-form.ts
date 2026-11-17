import { RequestError, type RequestFailure } from '../../../../../lib/aws/request';
import {
  createBucket,
  enableBucketVersioning,
  findBucket,
  NO_SUCH_BUCKET,
  putBucketEncryption,
  putPublicAccessBlock,
  type Bucket,
  type CreateBucketRequest,
  type KmsEncryption,
  type NoSuchBucket,
  type ObjectOwnership,
  type PublicAccessBlock,
  type Tag,
} from './api';

// The create form's values, what it checks before it sends, and what it sends (issue 256, requirement R6). The
// messages are EmuForge's own words (R6.3); each rule is one the emulator was seen to enforce, or the API model's
// minimum, as R6.3 says. Nothing typed is kept anywhere but in the form's own state.

/** "Encryption type", by the console's short names of the three types. */
export type EncryptionChoice = 'SSE-S3' | 'SSE-KMS' | 'DSSE-KMS';

/** The form's values, as the user set them. */
export interface BucketForm {
  name: string;
  ownership: ObjectOwnership;
  publicAccess: PublicAccessBlock;
  /** "Bucket Versioning" as the user last chose it; while Object Lock is on it is shown as "Enable" (R6.1). */
  versioning: boolean;
  tags: Tag[];
  encryption: EncryptionChoice;
  /** "AWS KMS key", the ARN as typed. */
  kmsKey: string;
  /** "Bucket Key", for SSE-KMS. */
  bucketKey: boolean;
  objectLock: boolean;
}

/** A bucket can have up to this many tags; with that many, "Add tag" is disabled (R6.3). */
export const MAX_TAGS = 50;

/** The reason "Add tag" is disabled. */
export const MAX_TAGS_REASON = 'A bucket can have up to 50 tags.';

/** The form as it opens: `?encryption=sse-kms` starts with SSE-KMS chosen, any other value is ignored (R6.2). */
export function initialBucketForm(search: URLSearchParams = new URLSearchParams()): BucketForm {
  return {
    name: '',
    ownership: 'BucketOwnerEnforced',
    publicAccess: {
      blockPublicAcls: true,
      ignorePublicAcls: true,
      blockPublicPolicy: true,
      restrictPublicBuckets: true,
    },
    versioning: false,
    tags: [],
    encryption: search.get('encryption') === 'sse-kms' ? 'SSE-KMS' : 'SSE-S3',
    kmsKey: '',
    bucketKey: true,
    objectLock: false,
  };
}

/** "Object Lock" set to `enabled`: turning it on shows "Enable" under "Bucket Versioning" and keeps it (R6.1). */
export function withObjectLock(form: BucketForm, enabled: boolean): BucketForm {
  return enabled ? { ...form, objectLock: true, versioning: true } : { ...form, objectLock: false };
}

/** "Bucket Versioning" as shown: "Enable" while Object Lock is on, else as chosen. */
export function versioningShown(form: BucketForm): boolean {
  return form.objectLock || form.versioning;
}

/** Whether "AWS KMS key" is shown: while the type is SSE-KMS or DSSE-KMS. */
export function kmsKeyShown(form: BucketForm): boolean {
  return form.encryption !== 'SSE-S3';
}

/** Whether "Bucket Key" is shown: while the type is SSE-KMS. */
export function bucketKeyShown(form: BucketForm): boolean {
  return form.encryption === 'SSE-KMS';
}

/** Whether "Add tag" is enabled. */
export function canAddTag(form: BucketForm): boolean {
  return form.tags.length < MAX_TAGS;
}

/** The messages of one tag. */
export interface TagMessages {
  key?: string;
  value?: string;
}

/** The message under each field that has one (R6.3). */
export interface FormMessages {
  name?: string;
  /** One entry per tag, in the form's order. */
  tags: TagMessages[];
  kmsKey?: string;
}

/** The length of a text in characters, as the API counts them. */
function characters(value: string): number {
  return [...value].length;
}

const NAME_CHARACTERS = /^[a-z0-9.-]*$/;
const LETTER_OR_DIGIT_AT_ENDS = /^[a-z0-9](.*[a-z0-9])?$/;
const IP_ADDRESS = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const RESERVED_PREFIXES = ['xn--', 'sthree-', 'amzn-s3-demo-'];
const RESERVED_SUFFIXES = ['-s3alias', '--ol-s3', '.mrap', '--x-s3', '--table-s3'];

/** The message for a bucket name, of the first rule it breaks, or none; the name is checked as typed. */
export function bucketNameMessage(name: string): string | undefined {
  if (name === '') {
    return 'Enter a bucket name.';
  }
  const length = characters(name);
  if (length < 3 || length > 63) {
    return 'The name must have 3 to 63 characters.';
  }
  if (!NAME_CHARACTERS.test(name)) {
    return 'Use only lowercase letters, digits, periods (.) and hyphens (-).';
  }
  if (!LETTER_OR_DIGIT_AT_ENDS.test(name)) {
    return 'The name must begin and end with a letter or digit.';
  }
  if (name.includes('..')) {
    return 'The name cannot have two periods in a row.';
  }
  const ip = IP_ADDRESS.exec(name);
  if (ip !== null && ip.slice(1).every((part) => Number(part) <= 255)) {
    return 'The name cannot be formatted as an IP address.';
  }
  const prefix = RESERVED_PREFIXES.find((reserved) => name.startsWith(reserved));
  if (prefix !== undefined) {
    return `The name cannot begin with “${prefix}”.`;
  }
  const suffix = RESERVED_SUFFIXES.find((reserved) => name.endsWith(reserved));
  if (suffix !== undefined) {
    return `The name cannot end with “${suffix}”.`;
  }
  return undefined;
}

function tagMessages(tags: readonly Tag[]): TagMessages[] {
  return tags.map(({ key, value }, index) => {
    const messages: TagMessages = {};
    if (key === '') {
      messages.key = 'Enter a key.';
    } else if (characters(key) > 128) {
      messages.key = 'A key can have up to 128 characters.';
    } else if (key.startsWith('aws:')) {
      messages.key = 'A key cannot begin with “aws:”.';
    } else if (tags.slice(0, index).some((earlier) => earlier.key === key)) {
      messages.key = 'This key is already used.';
    }
    if (characters(value) > 256) {
      messages.value = 'A value can have up to 256 characters.';
    }
    return messages;
  });
}

/** Every message of the form at "Create bucket". */
export function formMessages(form: BucketForm): FormMessages {
  const messages: FormMessages = { tags: tagMessages(form.tags) };
  const name = bucketNameMessage(form.name);
  if (name !== undefined) {
    messages.name = name;
  }
  if (kmsKeyShown(form) && form.kmsKey.trim() === '') {
    messages.kmsKey = 'Enter a KMS key ARN.';
  }
  return messages;
}

/** A field of the form that can carry a message. */
export type MessageField = { field: 'name' } | { field: 'tag-key' | 'tag-value'; index: number } | { field: 'kms-key' };

/** The first field with a message, in the form's order, which gets focus; none when nothing is shown. */
export function firstMessageField(messages: FormMessages): MessageField | undefined {
  if (messages.name !== undefined) {
    return { field: 'name' };
  }
  for (const [index, tag] of messages.tags.entries()) {
    if (tag.key !== undefined) {
      return { field: 'tag-key', index };
    }
    if (tag.value !== undefined) {
      return { field: 'tag-value', index };
    }
  }
  return messages.kmsKey === undefined ? undefined : { field: 'kms-key' };
}

/** A setting applied after `CreateBucket`, when it differs from what the emulator gives a new bucket (R6.4 step 3). */
export type SettingRequest =
  | { setting: 'public-access-block'; publicAccess: PublicAccessBlock }
  | { setting: 'versioning' }
  | { setting: 'encryption'; encryption: KmsEncryption };

/** What "Create bucket" sends after its check, in order. */
export interface BucketRequests {
  create: CreateBucketRequest;
  settings: SettingRequest[];
}

/** The `{what}` of a failed setting in the flash (R6.6). */
export const SETTING_WHAT: Readonly<Record<SettingRequest['setting'], string>> = {
  'public-access-block': 'Applying the Block Public Access settings',
  versioning: 'Enabling Bucket Versioning',
  encryption: 'Applying the default encryption',
};

/** The requests of a form without messages (R6.4 steps 2 and 3). */
export function bucketRequests(form: BucketForm): BucketRequests {
  const settings: SettingRequest[] = [];
  const { publicAccess } = form;
  if (
    !publicAccess.blockPublicAcls ||
    !publicAccess.ignorePublicAcls ||
    !publicAccess.blockPublicPolicy ||
    !publicAccess.restrictPublicBuckets
  ) {
    settings.push({ setting: 'public-access-block', publicAccess: { ...publicAccess } });
  }
  // Object Lock enables versioning itself (R2).
  if (form.versioning && !form.objectLock) {
    settings.push({ setting: 'versioning' });
  }
  if (form.encryption === 'SSE-KMS') {
    settings.push({
      setting: 'encryption',
      encryption: { algorithm: 'aws:kms', kmsKeyId: form.kmsKey.trim(), bucketKey: form.bucketKey },
    });
  } else if (form.encryption === 'DSSE-KMS') {
    settings.push({ setting: 'encryption', encryption: { algorithm: 'aws:kms:dsse', kmsKeyId: form.kmsKey.trim() } });
  }
  return {
    create: {
      bucket: form.name,
      ownership: form.ownership,
      objectLock: form.objectLock,
      tags: form.tags.map(({ key, value }) => ({ key, value })),
    },
    settings,
  };
}

/** The calls "Create bucket" makes. */
export interface CreateOperations {
  findBucket: (name: string, signal: AbortSignal) => Promise<Bucket | NoSuchBucket>;
  createBucket: (request: CreateBucketRequest, signal: AbortSignal) => Promise<void>;
  putPublicAccessBlock: (bucket: string, settings: PublicAccessBlock, signal: AbortSignal) => Promise<void>;
  enableBucketVersioning: (bucket: string, signal: AbortSignal) => Promise<void>;
  putBucketEncryption: (bucket: string, encryption: KmsEncryption, signal: AbortSignal) => Promise<void>;
}

/** The calls of "Create bucket" through the engine at `endpoint`. */
export function createOperations(endpoint: string): CreateOperations {
  return {
    findBucket: (name, signal) => findBucket(endpoint, name, signal),
    createBucket: (request, signal) => createBucket(endpoint, request, signal),
    putPublicAccessBlock: (bucket, settings, signal) => putPublicAccessBlock(endpoint, bucket, settings, signal),
    enableBucketVersioning: (bucket, signal) => enableBucketVersioning(endpoint, bucket, signal),
    putBucketEncryption: (bucket, encryption, signal) => putBucketEncryption(endpoint, bucket, encryption, signal),
  };
}

/** How "Create bucket" ended (R6.4, R6.6). */
export type CreateOutcome =
  /** The emulator already holds a bucket of that name: nothing was created. */
  | { outcome: 'name-taken' }
  /** `ListBuckets` ("check") or `CreateBucket` ("create") failed: nothing was created. */
  | { outcome: 'failed'; step: 'check' | 'create'; failure: RequestFailure }
  /** The bucket was created; each setting that failed, in the order sent. */
  | { outcome: 'created'; settingFailures: { setting: SettingRequest['setting']; failure: RequestFailure }[] };

function failureOf(error: unknown): RequestFailure {
  if (error instanceof RequestError) {
    return error.failure;
  }
  throw error;
}

function sendSetting(
  operations: CreateOperations,
  bucket: string,
  request: SettingRequest,
  signal: AbortSignal,
): Promise<void> {
  switch (request.setting) {
    case 'public-access-block':
      return operations.putPublicAccessBlock(bucket, request.publicAccess, signal);
    case 'versioning':
      return operations.enableBucketVersioning(bucket, signal);
    case 'encryption':
      return operations.putBucketEncryption(bucket, request.encryption, signal);
  }
}

/**
 * Sends a form without messages, each request after the previous one's answer (R6.4): the check of the name, then
 * `CreateBucket`, then each setting whatever the one before answered. Rejects with `signal`'s reason once it aborts.
 */
export async function submitBucketForm(
  form: BucketForm,
  operations: CreateOperations,
  signal: AbortSignal,
): Promise<CreateOutcome> {
  const { create, settings } = bucketRequests(form);
  try {
    if ((await operations.findBucket(create.bucket, signal)) !== NO_SUCH_BUCKET) {
      return { outcome: 'name-taken' };
    }
  } catch (error) {
    return { outcome: 'failed', step: 'check', failure: failureOf(error) };
  }
  try {
    await operations.createBucket(create, signal);
  } catch (error) {
    return { outcome: 'failed', step: 'create', failure: failureOf(error) };
  }
  const settingFailures: { setting: SettingRequest['setting']; failure: RequestFailure }[] = [];
  for (const request of settings) {
    try {
      await sendSetting(operations, create.bucket, request, signal);
    } catch (error) {
      settingFailures.push({ setting: request.setting, failure: failureOf(error) });
    }
  }
  return { outcome: 'created', settingFailures };
}

/** The message "Bucket name" gets when the emulator already holds that name (R6.4 step 1). */
export function nameTakenMessage(name: string): string {
  return `The emulator already holds a bucket named “${name}”.`;
}
