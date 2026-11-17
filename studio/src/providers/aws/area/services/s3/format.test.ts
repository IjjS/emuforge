import { describe, expect, it } from 'vitest';

import {
  bucketPath,
  bucketPropertiesPath,
  BUCKETS_PATH,
  bucketTabPath,
  CREATE_BUCKET_PATH,
  createEventNotificationPath,
  createIntelligentTieringPath,
  deleteBucketPath,
  DIRECTORY_BUCKETS_PATH,
  editPropertyPath,
  emptyBucketPath,
  encryptionTypeLabel,
  formatDays,
  formatRetentionPeriod,
  type BucketTab,
  type EditableProperty,
} from './format';

describe('the routes of the bucket list', () => {
  it.each([
    ['a b', 'a%20b'],
    ['50%', '50%25'],
    ['one/two', 'one%2Ftwo'],
  ])('carry the bucket name %j percent-encoded, as one path segment', (name, encoded) => {
    expect(bucketPath(name)).toBe(`/aws/s3/buckets/${encoded}`);
    expect(emptyBucketPath(name)).toBe(`/aws/s3/bucket/${encoded}/empty`);
    expect(deleteBucketPath(name)).toBe(`/aws/s3/bucket/${encoded}/delete`);
    for (const path of [bucketPath(name), emptyBucketPath(name), deleteBucketPath(name)]) {
      expect(path.split('/').map(decodeURIComponent)).toContain(name);
    }
  });

  it('leads a plain name to its routes unchanged', () => {
    expect(bucketPath('my-bucket')).toBe('/aws/s3/buckets/my-bucket');
    expect(emptyBucketPath('my-bucket')).toBe('/aws/s3/bucket/my-bucket/empty');
    expect(deleteBucketPath('my-bucket')).toBe('/aws/s3/bucket/my-bucket/delete');
  });

  it('gives the fixed routes of the list, "Create bucket" and "Directory buckets"', () => {
    expect(BUCKETS_PATH).toBe('/aws/s3/buckets');
    expect(CREATE_BUCKET_PATH).toBe('/aws/s3/bucket/create');
    expect(DIRECTORY_BUCKETS_PATH).toBe('/aws/s3/directory-buckets');
  });
});

const TABS: BucketTab[] = ['objects', 'metadata', 'permissions', 'metrics', 'management'];

const EDITABLE: EditableProperty[] = [
  'versioning',
  'abac',
  'tags',
  'encryption',
  'logging',
  'eventbridge',
  'transfer-acceleration',
  'object-lock',
  'requester-pays',
  'website',
];

describe('the routes of a bucket’s page', () => {
  it('give a bucket named my.bucket-1 its page, its "Properties" and the other five tabs', () => {
    expect(bucketPath('my.bucket-1')).toBe('/aws/s3/buckets/my.bucket-1');
    expect(bucketPropertiesPath('my.bucket-1')).toBe('/aws/s3/buckets/my.bucket-1/properties');
    expect(TABS.map((tab) => bucketTabPath('my.bucket-1', tab))).toEqual([
      '/aws/s3/buckets/my.bucket-1/objects',
      '/aws/s3/buckets/my.bucket-1/metadata',
      '/aws/s3/buckets/my.bucket-1/permissions',
      '/aws/s3/buckets/my.bucket-1/metrics',
      '/aws/s3/buckets/my.bucket-1/management',
    ]);
  });

  it.each(EDITABLE)('give the "Edit" of the section %s its edit route', (property) => {
    expect(editPropertyPath('my.bucket-1', property)).toBe(`/aws/s3/bucket/my.bucket-1/property/${property}/edit`);
  });

  it('give "Create configuration" and "Create event notification" their create routes', () => {
    expect(createIntelligentTieringPath('my.bucket-1')).toBe(
      '/aws/s3/bucket/my.bucket-1/property/intelligent-tiering/create',
    );
    expect(createEventNotificationPath('my.bucket-1')).toBe(
      '/aws/s3/bucket/my.bucket-1/property/event-notification/create',
    );
  });

  it('carry a name that needs encoding (a b) percent-encoded once, as one segment, in every one of them', () => {
    const paths = [
      bucketPath('a b'),
      bucketPropertiesPath('a b'),
      ...TABS.map((tab) => bucketTabPath('a b', tab)),
      ...EDITABLE.map((property) => editPropertyPath('a b', property)),
      createIntelligentTieringPath('a b'),
      createEventNotificationPath('a b'),
    ];
    for (const path of paths) {
      expect(path).toMatch(/\/a%20b(\/|$)/);
      expect(path).not.toContain('%2520');
      expect(path.split('/').filter((part) => decodeURIComponent(part) === 'a b')).toHaveLength(1);
    }
    expect(bucketPath('a b')).toBe('/aws/s3/buckets/a%20b');
    expect(editPropertyPath('a b', 'versioning')).toBe('/aws/s3/bucket/a%20b/property/versioning/edit');
  });
});

describe('the words of a bucket’s values', () => {
  it.each([
    ['AES256', 'Server-side encryption with Amazon S3 managed keys (SSE-S3)'],
    ['aws:kms', 'Server-side encryption with AWS Key Management Service keys (SSE-KMS)'],
    ['aws:kms:dsse', 'Dual-layer server-side encryption with AWS Key Management Service (AWS KMS) keys (DSSE-KMS)'],
    ['aws:other', 'aws:other'],
    ['constructor', 'constructor'],
  ])('write the encryption type %s as %j', (algorithm, label) => {
    expect(encryptionTypeLabel(algorithm)).toBe(label);
  });

  it.each([
    [{ unit: 'days', count: 1 } as const, '1 day'],
    [{ unit: 'days', count: 30 } as const, '30 days'],
    [{ unit: 'years', count: 1 } as const, '1 year'],
    [{ unit: 'years', count: 2 } as const, '2 years'],
  ])('write a retention of %j as %j', (period, text) => {
    expect(formatRetentionPeriod(period)).toBe(text);
  });

  it('writes a tiering of 90 days as "90 days"', () => {
    expect(formatDays(90)).toBe('90 days');
  });
});
