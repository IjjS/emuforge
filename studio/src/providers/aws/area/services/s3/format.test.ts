import { describe, expect, it } from 'vitest';

import {
  bucketPath,
  BUCKETS_PATH,
  CREATE_BUCKET_PATH,
  creationDateText,
  deleteBucketPath,
  DIRECTORY_BUCKETS_PATH,
  emptyBucketPath,
} from './format';

const INSTANT = new Date('2026-10-30T14:18:34Z');

describe('creationDateText', () => {
  it('writes the instant in the zone Asia/Seoul as the console does', () => {
    expect(creationDateText(INSTANT, 'Asia/Seoul')).toBe('October 30, 2026, 23:18:34 (UTC+09:00)');
  });

  it.each([
    ['UTC', 'October 30, 2026, 14:18:34 (UTC+00:00)'],
    ['America/St_Johns', 'October 30, 2026, 11:48:34 (UTC-02:30)'],
  ])('writes the same instant in %s with that zone’s offset', (zone, text) => {
    expect(creationDateText(INSTANT, zone)).toBe(text);
  });

  it('writes the hour after midnight as 00, on a 24-hour clock', () => {
    expect(creationDateText(new Date('2026-10-30T15:05:06Z'), 'Asia/Seoul')).toBe(
      'October 31, 2026, 00:05:06 (UTC+09:00)',
    );
  });

  it.each([undefined, new Date('not a date')])('writes "-" for no date (%s)', (date) => {
    expect(creationDateText(date, 'UTC')).toBe('-');
  });
});

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
