import { describe, expect, it } from 'vitest';

import {
  bucketPath,
  BUCKETS_PATH,
  CREATE_BUCKET_PATH,
  deleteBucketPath,
  DIRECTORY_BUCKETS_PATH,
  emptyBucketPath,
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
