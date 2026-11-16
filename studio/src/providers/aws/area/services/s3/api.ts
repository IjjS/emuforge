import { ListBucketsCommand, type ListBucketsCommandOutput, type S3Client } from '@aws-sdk/client-s3';

import { createS3Client, EngineSessionError } from '../../../../../lib/aws/client-factory';

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

/** Why a read failed, one kind per state of requirement R7 that the answer alone decides. */
export type ReadFailure =
  /** HTTP 501: the emulator does not implement the operation. */
  | { kind: 'not-implemented'; operation: string }
  /** `AccessDenied`, with the message returned. */
  | { kind: 'access-denied'; message: string }
  /** The engine's `EmulatorUnavailable` or `EmulatorTimeout`, with the engine's message as it came. */
  | { kind: 'emulator-did-not-answer'; message: string }
  /** No answer came from the engine: the request, or the session request before it, failed at the network level. */
  | { kind: 'engine-did-not-answer' }
  /** Any other answer: its code, or its status line when it has none, and its message when it has one. */
  | { kind: 'other'; code: string; message?: string };

/** A read that failed; carries what the answer said, nothing else. */
export class S3ReadError extends Error {
  readonly failure: ReadFailure;

  constructor(failure: ReadFailure) {
    super(`${LIST_BUCKETS} failed: ${failure.kind}.`);
    this.name = 'S3ReadError';
    this.failure = failure;
  }
}

/** The engine's two answers for an emulator that cannot be reached or does not answer in time. */
const EMULATOR_SILENT: ReadonlySet<string> = new Set(['EmulatorUnavailable', 'EmulatorTimeout']);

const ACCESS_DENIED = 'AccessDenied';

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

interface ErrorAnswer {
  Code?: unknown;
  message?: unknown;
  $metadata?: { httpStatusCode?: unknown };
  $response?: { reason?: unknown };
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function readFailure(error: unknown): ReadFailure {
  if (error instanceof EngineSessionError) {
    return error.reason === 'unreachable'
      ? { kind: 'engine-did-not-answer' }
      : { kind: 'other', code: error.code ?? `HTTP ${String(error.status)}` };
  }
  const answer = (typeof error === 'object' && error !== null ? error : {}) as ErrorAnswer;
  const status = answer.$metadata?.httpStatusCode;
  if (typeof status !== 'number') {
    return { kind: 'engine-did-not-answer' };
  }
  if (status === 501) {
    return { kind: 'not-implemented', operation: LIST_BUCKETS };
  }
  // The SDK names an answer without a code `Unknown`; `Code` holds only what the answer's body gave.
  const code = text(answer.Code);
  const message = code === undefined ? undefined : text(answer.message);
  if (code === ACCESS_DENIED) {
    return { kind: 'access-denied', message: message ?? '' };
  }
  if (code !== undefined && EMULATOR_SILENT.has(code)) {
    return { kind: 'emulator-did-not-answer', message: message ?? '' };
  }
  if (code === undefined) {
    const reason = text(answer.$response?.reason);
    return {
      kind: 'other',
      code: reason === undefined ? `HTTP ${String(status)}` : `HTTP ${String(status)} ${reason}`,
    };
  }
  return message === undefined ? { kind: 'other', code } : { kind: 'other', code, message };
}

/** `pending`, unless `signal` aborts first: then its reason, at once. */
function untilAborted<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      reject(signal.reason as Error);
    };
    signal.addEventListener('abort', abort, { once: true });
    pending.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort);
    });
  });
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
 * Rejects with `S3ReadError` for a failed read, and with `signal`'s reason, and nothing else, once it aborts.
 */
export async function listBuckets(
  endpoint: string,
  { pageSize, prefix, token }: BucketPageRequest,
  signal: AbortSignal,
): Promise<BucketPage> {
  signal.throwIfAborted();
  const command = new ListBucketsCommand({
    MaxBuckets: pageSize,
    ...(prefix === undefined || prefix === '' ? {} : { Prefix: prefix }),
    ...(token === undefined ? {} : { ContinuationToken: token }),
  });
  let output: ListBucketsCommandOutput;
  try {
    const sent = s3Client(endpoint).send(command, { abortSignal: signal });
    // Its rejection after an abort is the abort's, already given to the caller.
    sent.catch(() => undefined);
    output = await untilAborted(sent, signal);
  } catch (error) {
    if (signal.aborted) {
      throw signal.reason;
    }
    throw new S3ReadError(readFailure(error));
  }
  return toPage(output);
}
