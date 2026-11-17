import { describe, expect, it } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../lib/aws/request';
import { NO_SUCH_BUCKET, type Bucket, type NoSuchBucket } from './api';
import {
  bucketNameMessage,
  bucketRequests,
  canAddTag,
  firstMessageField,
  formMessages,
  initialBucketForm,
  kmsKeyShown,
  MAX_TAGS,
  submitBucketForm,
  versioningShown,
  withObjectLock,
  type BucketForm,
  type CreateOperations,
} from './bucket-form';

const CHARACTERS = 'Use only lowercase letters, digits, periods (.) and hyphens (-).';
const LENGTH = 'The name must have 3 to 63 characters.';
const ENDS = 'The name must begin and end with a letter or digit.';

function form(changes: Partial<BucketForm> = {}): BucketForm {
  return { ...initialBucketForm(), name: 'my-bucket', ...changes };
}

describe('the bucket name', () => {
  it('is "Enter a bucket name." when empty, and the message about characters for three spaces', () => {
    expect(bucketNameMessage('')).toBe('Enter a bucket name.');
    expect(bucketNameMessage('   ')).toBe(CHARACTERS);
  });

  it('must have 3 to 63 characters', () => {
    expect(bucketNameMessage('ab')).toBe(LENGTH);
    expect(bucketNameMessage('a'.repeat(64))).toBe(LENGTH);
    expect(bucketNameMessage('abc')).toBeUndefined();
    expect(bucketNameMessage('a'.repeat(63))).toBeUndefined();
  });

  it.each(['My-bucket', 'my_bucket', 'my bucket', 'my%bucket', '버킷-name'])('refuses the characters of %j', (name) => {
    expect(bucketNameMessage(name)).toBe(CHARACTERS);
  });

  it.each(['-abc', 'abc-', '.abc', 'abc.'])('must begin and end with a letter or digit: %j', (name) => {
    expect(bucketNameMessage(name)).toBe(ENDS);
  });

  it('cannot have two periods in a row; one period, and a period before a hyphen, are allowed', () => {
    expect(bucketNameMessage('a..b')).toBe('The name cannot have two periods in a row.');
    expect(bucketNameMessage('a.b')).toBeUndefined();
    expect(bucketNameMessage('a.-b')).toBeUndefined();
  });

  it('cannot be formatted as an IP address', () => {
    expect(bucketNameMessage('192.168.0.1')).toBe('The name cannot be formatted as an IP address.');
    expect(bucketNameMessage('0.0.0.0')).toBe('The name cannot be formatted as an IP address.');
    expect(bucketNameMessage('256.1.1.1')).toBeUndefined();
    expect(bucketNameMessage('1.2.3')).toBeUndefined();
  });

  it.each(['xn--', 'sthree-', 'amzn-s3-demo-'])('cannot begin with %j', (prefix) => {
    expect(bucketNameMessage(`${prefix}abc`)).toBe(`The name cannot begin with “${prefix}”.`);
  });

  it.each(['-s3alias', '--ol-s3', '.mrap', '--x-s3', '--table-s3'])('cannot end with %j', (suffix) => {
    expect(bucketNameMessage(`abc${suffix}`)).toBe(`The name cannot end with “${suffix}”.`);
  });

  it('gives the message of the first rule in the table’s order for a name that breaks two (A)', () => {
    expect(bucketNameMessage('A')).toBe(LENGTH);
  });
});

describe('the tags', () => {
  const tag = (key: string, value = '') => ({ key, value });

  it('need a key of 1 to 128 characters; a key of one space is a key', () => {
    expect(formMessages(form({ tags: [tag('')] })).tags).toEqual([{ key: 'Enter a key.' }]);
    expect(formMessages(form({ tags: [tag(' ')] })).tags).toEqual([{}]);
    expect(formMessages(form({ tags: [tag('k'.repeat(129))] })).tags).toEqual([
      { key: 'A key can have up to 128 characters.' },
    ]);
    expect(formMessages(form({ tags: [tag('k'.repeat(128))] })).tags).toEqual([{}]);
  });

  it('refuse a key beginning “aws:”, and a key used by an earlier tag on the later one only, case told apart', () => {
    expect(formMessages(form({ tags: [tag('aws:name')] })).tags).toEqual([{ key: 'A key cannot begin with “aws:”.' }]);
    expect(formMessages(form({ tags: [tag('env', 'a'), tag('env', 'b')] })).tags).toEqual([
      {},
      { key: 'This key is already used.' },
    ]);
    expect(formMessages(form({ tags: [tag('env'), tag('Env')] })).tags).toEqual([{}, {}]);
  });

  it('allow a value of up to 256 characters, and an empty value', () => {
    expect(formMessages(form({ tags: [tag('k', 'v'.repeat(257))] })).tags).toEqual([
      { value: 'A value can have up to 256 characters.' },
    ]);
    expect(formMessages(form({ tags: [tag('k', 'v'.repeat(256))] })).tags).toEqual([{}]);
    expect(formMessages(form({ tags: [tag('k', '')] })).tags).toEqual([{}]);
  });

  it(`can be added up to ${String(MAX_TAGS)}`, () => {
    const tags = Array.from({ length: MAX_TAGS }, (_, index) => tag(`k${String(index)}`));
    expect(canAddTag(form({ tags: tags.slice(1) }))).toBe(true);
    expect(canAddTag(form({ tags }))).toBe(false);
  });
});

describe('the KMS key', () => {
  it.each(['SSE-KMS', 'DSSE-KMS'] as const)(
    'is asked for, empty or spaces only, while the type is %s',
    (encryption) => {
      expect(formMessages(form({ encryption, kmsKey: '' })).kmsKey).toBe('Enter a KMS key ARN.');
      expect(formMessages(form({ encryption, kmsKey: '   ' })).kmsKey).toBe('Enter a KMS key ARN.');
      expect(formMessages(form({ encryption, kmsKey: 'arn:k' })).kmsKey).toBeUndefined();
    },
  );

  it('is not asked for while the type is SSE-S3', () => {
    expect(formMessages(form({ encryption: 'SSE-S3', kmsKey: '' })).kmsKey).toBeUndefined();
    expect(kmsKeyShown(form({ encryption: 'SSE-S3' }))).toBe(false);
  });
});

describe('the form as it opens', () => {
  it('starts with SSE-S3, or with SSE-KMS for ?encryption=sse-kms and nothing typed; another value is ignored', () => {
    expect(initialBucketForm().encryption).toBe('SSE-S3');
    expect(initialBucketForm(new URLSearchParams('encryption=sse-kms'))).toMatchObject({
      encryption: 'SSE-KMS',
      kmsKey: '',
      name: '',
    });
    expect(initialBucketForm(new URLSearchParams('encryption=dsse-kms')).encryption).toBe('SSE-S3');
  });

  it('has no message but the name’s, and puts focus on the first field with a message', () => {
    const messages = formMessages({ ...initialBucketForm(), tags: [{ key: '', value: '' }], encryption: 'SSE-KMS' });
    expect(firstMessageField(messages)).toEqual({ field: 'name' });
    expect(firstMessageField(formMessages(form({ tags: [{ key: 'a', value: 'v'.repeat(300) }] })))).toEqual({
      field: 'tag-value',
      index: 0,
    });
    expect(firstMessageField(formMessages(form({ encryption: 'DSSE-KMS' })))).toEqual({ field: 'kms-key' });
    expect(firstMessageField(formMessages(form()))).toBeUndefined();
  });

  it('shows "Enable" under versioning while Object Lock is on, and keeps it when Object Lock is turned off', () => {
    const locked = withObjectLock(form(), true);
    expect(versioningShown(locked)).toBe(true);
    const unlocked = withObjectLock(locked, false);
    expect(unlocked.objectLock).toBe(false);
    expect(versioningShown(unlocked)).toBe(true);
    expect(versioningShown({ ...unlocked, versioning: false })).toBe(false);
  });
});

describe('the requests', () => {
  it('are CreateBucket with the bucket and BucketOwnerEnforced alone, and nothing after it, for a form as at start', () => {
    expect(bucketRequests(form())).toEqual({
      create: { bucket: 'my-bucket', ownership: 'BucketOwnerEnforced', objectLock: false, tags: [] },
      settings: [],
    });
  });

  it('carry ObjectWriter, two tags as typed and Object Lock, and no versioning request although "Enable" is shown', () => {
    const tags = [
      { key: 'env', value: 'dev' },
      { key: ' spaced ', value: '' },
    ];
    const locked = withObjectLock(form({ ownership: 'ObjectWriter', tags }), true);

    expect(versioningShown(locked)).toBe(true);
    expect(bucketRequests(locked)).toEqual({
      create: { bucket: 'my-bucket', ownership: 'ObjectWriter', objectLock: true, tags },
      settings: [],
    });
  });

  it('put the public access block with one setting false and the others true when one box is unchecked', () => {
    const publicAccess = { ...initialBucketForm().publicAccess, blockPublicPolicy: false };

    expect(bucketRequests(form({ publicAccess })).settings).toEqual([
      {
        setting: 'public-access-block',
        publicAccess: {
          blockPublicAcls: true,
          ignorePublicAcls: true,
          blockPublicPolicy: false,
          restrictPublicBuckets: true,
        },
      },
    ]);
  });

  it('put versioning Enabled for "Enable" without Object Lock', () => {
    expect(bucketRequests(form({ versioning: true })).settings).toEqual([{ setting: 'versioning' }]);
  });

  it('put aws:kms with the ARN without its spaces and the bucket key off, and aws:kms:dsse with the ARN and no bucket key', () => {
    const arn = 'arn:aws:kms:us-east-1:000000000000:key/k';
    expect(bucketRequests(form({ encryption: 'SSE-KMS', kmsKey: ` ${arn} `, bucketKey: false })).settings).toEqual([
      { setting: 'encryption', encryption: { algorithm: 'aws:kms', kmsKeyId: arn, bucketKey: false } },
    ]);
    expect(bucketRequests(form({ encryption: 'DSSE-KMS', kmsKey: arn })).settings).toEqual([
      { setting: 'encryption', encryption: { algorithm: 'aws:kms:dsse', kmsKeyId: arn } },
    ]);
  });

  it('come in the order public access block, versioning, encryption when all three are changed', () => {
    const changed = form({
      publicAccess: { ...initialBucketForm().publicAccess, ignorePublicAcls: false },
      versioning: true,
      encryption: 'SSE-KMS',
      kmsKey: 'arn:k',
    });

    expect(bucketRequests(changed).settings.map((request) => request.setting)).toEqual([
      'public-access-block',
      'versioning',
      'encryption',
    ]);
  });
});

describe('"Create bucket"', () => {
  type Result = 'ok' | RequestFailure;

  /** Operations that record every call and answer as the case says. */
  function operations(found: Bucket | NoSuchBucket | RequestFailure, answers: Partial<Record<string, Result>> = {}) {
    const calls: string[] = [];
    const answer = (operation: string): Promise<void> => {
      calls.push(operation);
      const result = answers[operation] ?? 'ok';
      return result === 'ok' ? Promise.resolve() : Promise.reject(new RequestError(result));
    };
    const ops: CreateOperations = {
      findBucket: (name) => {
        calls.push(`ListBuckets ${name}`);
        return typeof found === 'object' && 'kind' in found
          ? Promise.reject(new RequestError(found))
          : Promise.resolve(found);
      },
      createBucket: () => answer('CreateBucket'),
      putPublicAccessBlock: () => answer('PutPublicAccessBlock'),
      enableBucketVersioning: () => answer('PutBucketVersioning'),
      putBucketEncryption: () => answer('PutBucketEncryption'),
    };
    return { calls, ops };
  }

  const all = form({
    publicAccess: { ...initialBucketForm().publicAccess, ignorePublicAcls: false },
    versioning: true,
    encryption: 'DSSE-KMS',
    kmsKey: 'arn:k',
  });
  const signal = new AbortController().signal;

  it('checks the name, creates the bucket, then sends each setting whatever the one before answered', async () => {
    const failed: RequestFailure = { kind: 'other', operation: 'PutPublicAccessBlock', code: 'InternalError' };
    const { calls, ops } = operations(NO_SUCH_BUCKET, { PutPublicAccessBlock: failed });

    expect(await submitBucketForm(all, ops, signal)).toEqual({
      outcome: 'created',
      settingFailures: [{ setting: 'public-access-block', failure: failed }],
    });
    expect(calls).toEqual([
      'ListBuckets my-bucket',
      'CreateBucket',
      'PutPublicAccessBlock',
      'PutBucketVersioning',
      'PutBucketEncryption',
    ]);
  });

  it('sends nothing more when the emulator already holds a bucket of that name', async () => {
    const { calls, ops } = operations({ name: 'my-bucket' });

    expect(await submitBucketForm(all, ops, signal)).toEqual({ outcome: 'name-taken' });
    expect(calls).toEqual(['ListBuckets my-bucket']);
  });

  it('stops with the failure of the check or of CreateBucket, and sends no setting', async () => {
    const check: RequestFailure = { kind: 'engine-did-not-answer', operation: 'ListBuckets' };
    const first = operations(check);
    expect(await submitBucketForm(all, first.ops, signal)).toEqual({
      outcome: 'failed',
      step: 'check',
      failure: check,
    });
    expect(first.calls).toEqual(['ListBuckets my-bucket']);

    const create: RequestFailure = { kind: 'other', operation: 'CreateBucket', code: 'InvalidBucketName' };
    const second = operations(NO_SUCH_BUCKET, { CreateBucket: create });
    expect(await submitBucketForm(all, second.ops, signal)).toEqual({
      outcome: 'failed',
      step: 'create',
      failure: create,
    });
    expect(second.calls).toEqual(['ListBuckets my-bucket', 'CreateBucket']);
  });
});
