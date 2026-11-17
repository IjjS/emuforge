import { ListBucketsCommand, type ListBucketsCommandOutput, type S3Client } from '@aws-sdk/client-s3';

import { createS3Client } from '../../../../../lib/aws/client-factory';
import { sendRequest } from '../../../../../lib/aws/request';

// The S3 calls of the AWS area (issue 56, requirement R2, R4, R7): `ListBuckets` through the engine, mapped to plain
// typed results. Every value in a result comes from the emulator's answer, unchanged; each is untrusted text.

/** One bucket of a `ListBuckets` answer. A value the answer did not give is absent. */
export interface Bucket {
  name: string;
  /** The Region code, `BucketRegion`. */
  region?: string;
  /** `CreationDate`. */
  creationDate?: Date;
  /** `BucketArn`, as the emulator returned it. */
  arn?: string;
}

/** One page of the bucket list, in the answer's order. */
export interface BucketPage {
  buckets: Bucket[];
  /** The answer's `ContinuationToken`: more buckets remain after this page. */
  nextToken?: string;
}

/** What one page is asked with. */
export interface BucketPageRequest {
  /** `max-buckets`, always sent: without it the emulator gives no Region per bucket. */
  pageSize: number;
  /** `prefix`; an empty text is not sent. */
  prefix?: string;
  /** `continuation-token`, the token of the page before. */
  token?: string;
}

/** The operation the list calls, as a 501 answer names it. */
export const LIST_BUCKETS = 'ListBuckets';

const clients = new Map<string, S3Client>();

/** The area's S3 client for the engine at `endpoint`, one per endpoint for the life of the page. */
function s3Client(endpoint: string): S3Client {
  let client = clients.get(endpoint);
  if (client === undefined) {
    client = createS3Client({ endpoint });
    clients.set(endpoint, client);
  }
  return client;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function toBucket({
  Name,
  BucketRegion,
  CreationDate,
  BucketArn,
}: NonNullable<ListBucketsCommandOutput['Buckets']>[number]): Bucket {
  const bucket: Bucket = { name: Name ?? '' };
  const region = text(BucketRegion);
  if (region !== undefined) {
    bucket.region = region;
  }
  if (CreationDate instanceof Date && !Number.isNaN(CreationDate.getTime())) {
    bucket.creationDate = CreationDate;
  }
  const arn = text(BucketArn);
  if (arn !== undefined) {
    bucket.arn = arn;
  }
  return bucket;
}

function toPage(output: ListBucketsCommandOutput): BucketPage {
  const page: BucketPage = { buckets: (output.Buckets ?? []).map(toBucket) };
  const token = text(output.ContinuationToken);
  if (token !== undefined) {
    page.nextToken = token;
  }
  return page;
}

/**
 * One page of the emulator's general purpose buckets, read through the engine at `endpoint` with `ListBuckets`.
 * Rejects with the shared module's `RequestError` for a failed read, and with `signal`'s reason, and nothing else,
 * once it aborts.
 */
export async function listBuckets(
  endpoint: string,
  { pageSize, prefix, token }: BucketPageRequest,
  signal: AbortSignal,
): Promise<BucketPage> {
  const command = new ListBucketsCommand({
    MaxBuckets: pageSize,
    ...(prefix === undefined || prefix === '' ? {} : { Prefix: prefix }),
    ...(token === undefined ? {} : { ContinuationToken: token }),
  });
  const output = await sendRequest(
    LIST_BUCKETS,
    (abortSignal) => s3Client(endpoint).send(command, { abortSignal }),
    signal,
  );
  return toPage(output);
}
