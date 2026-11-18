import { describe, expect, it } from 'vitest';

import {
  bucketPath,
  bucketPropertiesPath,
  BUCKETS_PATH,
  CREATE_BUCKET_PATH,
  createEventNotificationPath,
  deleteBucketPath,
  editPropertyPath,
  emptyBucketPath,
  encryptionTypeLabel,
  FOLDER_TYPE,
  formatSize,
  keyType,
  objectPath,
  objectsPath,
  prefixParts,
  s3Uri,
  uploadPath,
  type EditableProperty,
} from './format';
import * as format from './format';

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

  it('gives the fixed routes of the list and "Create bucket"', () => {
    expect(BUCKETS_PATH).toBe('/aws/s3/buckets');
    expect(CREATE_BUCKET_PATH).toBe('/aws/s3/bucket/create');
  });
});

const EDITABLE: EditableProperty[] = ['versioning', 'tags', 'encryption', 'website'];

describe('the routes of a bucket’s page', () => {
  it('give a bucket named my.bucket-1 its page (the tab "Objects" at the root) and its "Properties"', () => {
    expect(bucketPath('my.bucket-1')).toBe('/aws/s3/buckets/my.bucket-1');
    expect(objectsPath('my.bucket-1')).toBe('/aws/s3/buckets/my.bucket-1');
    expect(bucketPropertiesPath('my.bucket-1')).toBe('/aws/s3/buckets/my.bucket-1/properties');
  });

  it.each(EDITABLE)('give the "Edit" of the section %s its edit route', (property) => {
    expect(editPropertyPath('my.bucket-1', property)).toBe(`/aws/s3/bucket/my.bucket-1/property/${property}/edit`);
  });

  it('give "Create event notification" its create route', () => {
    expect(createEventNotificationPath('my.bucket-1')).toBe(
      '/aws/s3/bucket/my.bucket-1/property/event-notification/create',
    );
  });

  it('carry a name that needs encoding (a b) percent-encoded once, as one segment, in every one of them', () => {
    const paths = [
      bucketPath('a b'),
      bucketPropertiesPath('a b'),
      ...EDITABLE.map((property) => editPropertyPath('a b', property)),
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
});

// Issue 480 (test-criteria.md, "Unit s1 — services/s3/format.test.ts").
const KEYS = ['q?#%.txt', 'a&b/c d.txt', 'logs/2026/', '한글/파일.txt', 'd//e.txt', '%2F'];

describe('the addresses of the tab "Objects", an object and "Upload"', () => {
  it.each(KEYS)('carry %j in the query, encoded so it round-trips, never in a path segment', (value) => {
    const objects = new URL(objectsPath('my.bucket-1', value), 'http://studio');
    expect(objects.pathname).toBe('/aws/s3/buckets/my.bucket-1');
    expect(objects.searchParams.get('prefix')).toBe(value);
    expect(objects.hash).toBe('');

    const object = new URL(objectPath('my.bucket-1', value), 'http://studio');
    expect(object.pathname).toBe('/aws/s3/buckets/my.bucket-1/object');
    expect(object.searchParams.get('key')).toBe(value);
    expect(object.hash).toBe('');

    const upload = new URL(uploadPath('my.bucket-1', value), 'http://studio');
    expect(upload.pathname).toBe('/aws/s3/bucket/my.bucket-1/upload');
    expect(upload.searchParams.get('prefix')).toBe(value);
    expect(upload.hash).toBe('');
  });

  it('give the root of a bucket, and an upload into it, without a query', () => {
    expect(objectsPath('my.bucket-1', '')).toBe('/aws/s3/buckets/my.bucket-1');
    expect(uploadPath('my.bucket-1')).toBe('/aws/s3/bucket/my.bucket-1/upload');
  });

  it('give an S3 URI with the key as it is', () => {
    expect(s3Uri('my.bucket-1', 'logs/2026/x.json')).toBe('s3://my.bucket-1/logs/2026/x.json');
  });

  it('give the parts of a prefix, from the root down, each opening its own prefix', () => {
    expect(prefixParts('')).toEqual([]);
    expect(prefixParts('logs/2026/')).toEqual([
      { text: 'logs', prefix: 'logs/' },
      { text: '2026', prefix: 'logs/2026/' },
    ]);
    expect(prefixParts('d//')).toEqual([
      { text: 'd', prefix: 'd/' },
      { text: '/', prefix: 'd//' },
    ]);
    expect(prefixParts('logs/lo')).toEqual([
      { text: 'logs', prefix: 'logs/' },
      { text: 'lo', prefix: 'logs/lo' },
    ]);
  });
});

describe('the words of an object row', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1023, '1023 B'],
    [1024, '1.0 KiB'],
    [1536, '1.5 KiB'],
    [20 * 1024 * 1024, '20.0 MiB'],
    [1024 * 1024 - 1, '1.0 MiB'],
    [Math.round(1.2 * 1024 ** 3), '1.2 GiB'],
  ])('write a size of %d bytes as %j, base 1024', (bytes, text) => {
    expect(formatSize(bytes)).toBe(text);
  });

  it.each([
    ['x.json', 'json'],
    ['logs/2026/archive.tar.gz', 'gz'],
    ['README', '-'],
    ['dir.d/README', '-'],
    ['.env', '-'],
    ['trailing.', '-'],
  ])('give the key %j the type %j', (key, type) => {
    expect(keyType(key)).toBe(type);
  });

  it('give a folder row the type "Folder"', () => {
    expect(FOLDER_TYPE).toBe('Folder');
  });
});

describe('what issue 480 removed', () => {
  it('leaves no route of Directory buckets, the tabs Metadata, Permissions, Metrics, Management or the dropped sections', () => {
    const names = Object.keys(format);
    for (const gone of [
      'DIRECTORY_BUCKETS_PATH',
      'bucketTabPath',
      'createIntelligentTieringPath',
      'formatDays',
      'formatYears',
      'formatRetentionPeriod',
    ]) {
      expect(names).not.toContain(gone);
    }
    const routes = [
      ...EDITABLE.map((property) => editPropertyPath('b', property)),
      createEventNotificationPath('b'),
      bucketPropertiesPath('b'),
      objectsPath('b'),
    ];
    for (const dropped of [
      'directory-buckets',
      '/metadata',
      '/permissions',
      '/metrics',
      '/management',
      'abac',
      'intelligent-tiering',
      'logging',
      'eventbridge',
      'transfer-acceleration',
      'object-lock',
      'requester-pays',
    ]) {
      expect(routes.filter((route) => route.includes(dropped))).toEqual([]);
    }
  });
});
