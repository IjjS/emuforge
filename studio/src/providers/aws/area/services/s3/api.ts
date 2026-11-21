import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  GetBucketEncryptionCommand,
  GetBucketNotificationConfigurationCommand,
  GetBucketTaggingCommand,
  GetBucketVersioningCommand,
  GetBucketWebsiteCommand,
  GetObjectCommand,
  GetObjectTaggingCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  PutBucketEncryptionCommand,
  PutBucketNotificationConfigurationCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
  PutPublicAccessBlockCommand,
  UploadPartCommand,
  type NotificationConfiguration,
  type HeadObjectCommandOutput,
  type ListBucketsCommandOutput,
  type ListObjectsV2CommandOutput,
  type S3Client,
} from '@aws-sdk/client-s3';

import { createS3Client } from '../../../../../lib/aws/client-factory';
import { RequestError, sendRequest } from '../../../../../lib/aws/request';

// The S3 calls of the AWS area (issue 56, requirement R2, R4, R7; issue 256, requirement R2, R5 to R8), through the
// engine, mapped to plain typed results. Every value in a result comes from the emulator's answer, unchanged; each
// is untrusted text. Every command goes through the shared `sendRequest` with its operation's name (issue 445), so
// a failed request rejects with its `RequestError` and an aborted one with the signal's reason. What this file
// reads of a failure is only the two kinds of answer that are not failures here: "no such bucket", and the codes
// with which the emulator says a setting is not set.

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

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
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

/** The emulator holds no bucket of the name asked: `ListBuckets` did not return it, or a call answered `NoSuchBucket`. */
export const NO_SUCH_BUCKET = 'no-such-bucket';
export type NoSuchBucket = typeof NO_SUCH_BUCKET;

/** The code with which every call on a bucket says the emulator holds no bucket of that name. */
const NO_SUCH_BUCKET_CODE = 'NoSuchBucket';

/** The operations of a bucket's screens, as a failure names them. */
export const OPERATIONS = {
  getBucketVersioning: 'GetBucketVersioning',
  getBucketTagging: 'GetBucketTagging',
  getBucketEncryption: 'GetBucketEncryption',
  getBucketNotificationConfiguration: 'GetBucketNotificationConfiguration',
  putBucketNotificationConfiguration: 'PutBucketNotificationConfiguration',
  getBucketWebsite: 'GetBucketWebsite',
  listObjectsV2: 'ListObjectsV2',
  listObjectVersions: 'ListObjectVersions',
  deleteObjects: 'DeleteObjects',
  deleteBucket: 'DeleteBucket',
  createBucket: 'CreateBucket',
  putPublicAccessBlock: 'PutPublicAccessBlock',
  putBucketVersioning: 'PutBucketVersioning',
  putBucketEncryption: 'PutBucketEncryption',
  headObject: 'HeadObject',
  getObjectTagging: 'GetObjectTagging',
  getObject: 'GetObject',
  putObject: 'PutObject',
  createMultipartUpload: 'CreateMultipartUpload',
  uploadPart: 'UploadPart',
  completeMultipartUpload: 'CompleteMultipartUpload',
  abortMultipartUpload: 'AbortMultipartUpload',
} as const;

/** The code of an answer that is neither a success nor a failure kind of its own, else `undefined`. */
function answeredCode(error: unknown): string | undefined {
  return error instanceof RequestError && error.failure.kind === 'other' ? error.failure.code : undefined;
}

/**
 * One call of `operation` on bucket `bucket`, its answer given to `toResult`. "No such bucket" is
 * `NO_SUCH_BUCKET`; an answer of `notSet`'s code is `notSet`'s result; every other failure rejects as it came.
 */
async function onBucket<Output, Result>(
  endpoint: string,
  operation: string,
  send: (client: S3Client, abortSignal: AbortSignal) => Promise<Output>,
  toResult: (output: Output) => Result,
  signal: AbortSignal,
  notSet?: { code: string; result: Result },
): Promise<Result | NoSuchBucket> {
  let output: Output;
  try {
    output = await sendRequest(operation, (abortSignal) => send(s3Client(endpoint), abortSignal), signal);
  } catch (error) {
    const code = answeredCode(error);
    if (code === NO_SUCH_BUCKET_CODE) {
      return NO_SUCH_BUCKET;
    }
    if (notSet !== undefined && code === notSet.code) {
      return notSet.result;
    }
    throw error;
  }
  return toResult(output);
}

/**
 * The bucket named `name` as `ListBuckets` gives it (R5.1): asked with that name as prefix and one bucket at most.
 * A first bucket of another name, or none, is `NO_SUCH_BUCKET`. `HeadBucket` is never called (R2).
 */
export async function findBucket(endpoint: string, name: string, signal: AbortSignal): Promise<Bucket | NoSuchBucket> {
  const { buckets } = await listBuckets(endpoint, { pageSize: 1, prefix: name }, signal);
  const [first] = buckets;
  return first !== undefined && first.name === name ? first : NO_SUCH_BUCKET;
}

/** "Enabled", "Suspended" or "Disabled": the status of Bucket Versioning. */
export interface StatusSetting {
  status: string;
}

/** "Bucket Versioning" (R5.3): "Disabled" when the answer has no `Status`. */
export function getBucketVersioning(
  endpoint: string,
  bucket: string,
  signal: AbortSignal,
): Promise<StatusSetting | NoSuchBucket> {
  return onBucket(
    endpoint,
    OPERATIONS.getBucketVersioning,
    (client, abortSignal) => client.send(new GetBucketVersioningCommand({ Bucket: bucket }), { abortSignal }),
    (output) => ({ status: text(output.Status) ?? 'Disabled' }),
    signal,
  );
}

/** One tag of a bucket. */
export interface Tag {
  key: string;
  value: string;
}

/** The bucket's tags in the answer's order; none for `NoSuchTagSet` or an empty set (R5.3). */
export function getBucketTagging(endpoint: string, bucket: string, signal: AbortSignal): Promise<Tag[] | NoSuchBucket> {
  return onBucket(
    endpoint,
    OPERATIONS.getBucketTagging,
    (client, abortSignal) => client.send(new GetBucketTaggingCommand({ Bucket: bucket }), { abortSignal }),
    (output) => (output.TagSet ?? []).map(({ Key, Value }) => ({ key: Key ?? '', value: Value ?? '' })),
    signal,
    { code: 'NoSuchTagSet', result: [] },
  );
}

/** "Default encryption" (R5.3), from the configuration's first rule. */
export interface EncryptionSetting {
  /** `SSEAlgorithm` as it came; absent when the answer has none. */
  algorithm?: string;
  /** "AWS KMS key", `KMSMasterKeyID`. */
  kmsKey?: string;
  /** "Bucket Key": "Enabled" when `BucketKeyEnabled` is true, else "Disabled". */
  bucketKey: 'Enabled' | 'Disabled';
}

export function getBucketEncryption(
  endpoint: string,
  bucket: string,
  signal: AbortSignal,
): Promise<EncryptionSetting | NoSuchBucket> {
  return onBucket(
    endpoint,
    OPERATIONS.getBucketEncryption,
    (client, abortSignal) => client.send(new GetBucketEncryptionCommand({ Bucket: bucket }), { abortSignal }),
    (output) => {
      const [rule] = output.ServerSideEncryptionConfiguration?.Rules ?? [];
      const algorithm = text(rule?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm);
      const kmsKey = text(rule?.ApplyServerSideEncryptionByDefault?.KMSMasterKeyID);
      return {
        ...(algorithm === undefined ? {} : { algorithm }),
        ...(kmsKey === undefined ? {} : { kmsKey }),
        bucketKey: rule?.BucketKeyEnabled === true ? 'Enabled' : 'Disabled',
      };
    },
    signal,
  );
}

export type { NotificationConfiguration } from '@aws-sdk/client-s3';

export function getBucketNotificationConfiguration(
  endpoint: string,
  bucket: string,
  signal: AbortSignal,
): Promise<NotificationConfiguration | NoSuchBucket> {
  return onBucket(
    endpoint,
    OPERATIONS.getBucketNotificationConfiguration,
    (client, abortSignal) =>
      client.send(new GetBucketNotificationConfigurationCommand({ Bucket: bucket }), { abortSignal }),
    ({ QueueConfigurations, LambdaFunctionConfigurations, TopicConfigurations, EventBridgeConfiguration }) => ({
      QueueConfigurations,
      LambdaFunctionConfigurations,
      TopicConfigurations,
      EventBridgeConfiguration,
    }),
    signal,
  );
}

export function putBucketNotificationConfiguration(
  endpoint: string,
  bucket: string,
  configuration: NotificationConfiguration,
  signal: AbortSignal,
): Promise<void | NoSuchBucket> {
  return onBucket(
    endpoint,
    OPERATIONS.putBucketNotificationConfiguration,
    (client, abortSignal) =>
      client.send(
        new PutBucketNotificationConfigurationCommand({ Bucket: bucket, NotificationConfiguration: configuration }),
        { abortSignal },
      ),
    () => undefined,
    signal,
  );
}

/** "Static website hosting" (R5.3). */
export interface WebsiteSetting {
  status: 'Enabled' | 'Disabled';
  /** "Index document", `IndexDocument.Suffix`. */
  indexDocument?: string;
  /** "Error document", `ErrorDocument.Key`. */
  errorDocument?: string;
}

export function getBucketWebsite(
  endpoint: string,
  bucket: string,
  signal: AbortSignal,
): Promise<WebsiteSetting | NoSuchBucket> {
  return onBucket(
    endpoint,
    OPERATIONS.getBucketWebsite,
    (client, abortSignal) => client.send(new GetBucketWebsiteCommand({ Bucket: bucket }), { abortSignal }),
    (output): WebsiteSetting => {
      const indexDocument = text(output.IndexDocument?.Suffix);
      const errorDocument = text(output.ErrorDocument?.Key);
      return {
        status: 'Enabled',
        ...(indexDocument === undefined ? {} : { indexDocument }),
        ...(errorDocument === undefined ? {} : { errorDocument }),
      };
    },
    signal,
    { code: 'NoSuchWebsiteConfiguration', result: { status: 'Disabled' } },
  );
}

/** A folder of a listing: a common prefix of its answer (issue 480, task 1). */
export interface ObjectFolder {
  /** The whole prefix, as the emulator gave it (`logs/2026/`). */
  prefix: string;
  /** The part after the listing's prefix (`2026/`). */
  name: string;
}

/** An object of a listing. A value the answer did not give is absent. */
export interface ObjectEntry {
  /** The whole key, as the emulator gave it. */
  key: string;
  /** The part after the listing's prefix. */
  name: string;
  size?: number;
  lastModified?: Date;
  storageClass?: string;
}

/** One page of a bucket's objects under a prefix: its folders, then its objects, each in the answer's order. */
export interface ObjectPage {
  folders: ObjectFolder[];
  objects: ObjectEntry[];
  /** `NextContinuationToken`, while the answer is truncated: more remain after this page. */
  nextToken?: string;
}

/** What one page of objects is asked with. */
export interface ObjectPageRequest {
  /** `Prefix`; an empty text is not sent. */
  prefix: string;
  /** `MaxKeys`. */
  pageSize: number;
  /** `ContinuationToken`, the token of the page before. */
  token?: string;
}

/** The part of `whole` after `prefix`, or `whole` when it does not start with it. */
function after(prefix: string, whole: string): string {
  return whole.startsWith(prefix) ? whole.slice(prefix.length) : whole;
}

function toObjectPage(prefix: string, output: ListObjectsV2CommandOutput): ObjectPage {
  const page: ObjectPage = {
    folders: (output.CommonPrefixes ?? []).flatMap(({ Prefix }) =>
      Prefix === undefined || Prefix === '' ? [] : [{ prefix: Prefix, name: after(prefix, Prefix) }],
    ),
    objects: (output.Contents ?? []).map(({ Key, Size, LastModified, StorageClass }) => {
      const key = Key ?? '';
      const entry: ObjectEntry = { key, name: after(prefix, key) };
      const size = number(Size);
      const storageClass = text(StorageClass);
      if (size !== undefined) entry.size = size;
      if (LastModified instanceof Date && !Number.isNaN(LastModified.getTime())) entry.lastModified = LastModified;
      if (storageClass !== undefined) entry.storageClass = storageClass;
      return entry;
    }),
  };
  const token = text(output.NextContinuationToken);
  if (output.IsTruncated === true && token !== undefined) {
    page.nextToken = token;
  }
  return page;
}

/**
 * One page of the folders and objects of bucket `bucket` under `prefix` (issue 480, task 1): `ListObjectsV2` with the
 * delimiter `/`, so a deeper key is a folder of this page. "No such bucket" is `NO_SUCH_BUCKET`.
 */
export function listObjects(
  endpoint: string,
  bucket: string,
  { prefix, pageSize, token }: ObjectPageRequest,
  signal: AbortSignal,
): Promise<ObjectPage | NoSuchBucket> {
  return onBucket(
    endpoint,
    OPERATIONS.listObjectsV2,
    (client, abortSignal) =>
      client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Delimiter: '/',
          MaxKeys: pageSize,
          ...(prefix === '' ? {} : { Prefix: prefix }),
          ...(token === undefined ? {} : { ContinuationToken: token }),
        }),
        { abortSignal },
      ),
    (output) => toObjectPage(prefix, output),
    signal,
  );
}

/** An object version or a delete marker, by its key and version id (R8.5's "item"). */
export interface ObjectVersionId {
  key: string;
  /** `VersionId` as it came, `null` in an unversioned bucket; absent when the answer has none. */
  versionId?: string;
}

/** One page of `ListObjectVersions`: its versions, then its delete markers. */
export interface ObjectVersionPage {
  items: ObjectVersionId[];
  truncated: boolean;
  nextKeyMarker?: string;
  nextVersionIdMarker?: string;
}

/** Where a page of `ListObjectVersions` starts, and how many items it holds at most. */
export interface ObjectVersionPageRequest {
  maxKeys: number;
  keyMarker?: string;
  versionIdMarker?: string;
}

function toItem({ Key, VersionId }: { Key?: string | undefined; VersionId?: string | undefined }): ObjectVersionId {
  return VersionId === undefined ? { key: Key ?? '' } : { key: Key ?? '', versionId: VersionId };
}

/** One page of the bucket's object versions and delete markers. */
export function listObjectVersions(
  endpoint: string,
  bucket: string,
  { maxKeys, keyMarker, versionIdMarker }: ObjectVersionPageRequest,
  signal: AbortSignal,
): Promise<ObjectVersionPage | NoSuchBucket> {
  return onBucket(
    endpoint,
    OPERATIONS.listObjectVersions,
    (client, abortSignal) =>
      client.send(
        new ListObjectVersionsCommand({
          Bucket: bucket,
          MaxKeys: maxKeys,
          ...(keyMarker === undefined ? {} : { KeyMarker: keyMarker }),
          ...(versionIdMarker === undefined ? {} : { VersionIdMarker: versionIdMarker }),
        }),
        { abortSignal },
      ),
    (output): ObjectVersionPage => {
      const page: ObjectVersionPage = {
        items: [...(output.Versions ?? []).map(toItem), ...(output.DeleteMarkers ?? []).map(toItem)],
        truncated: output.IsTruncated === true,
      };
      const nextKeyMarker = text(output.NextKeyMarker);
      const nextVersionIdMarker = text(output.NextVersionIdMarker);
      if (nextKeyMarker !== undefined) page.nextKeyMarker = nextKeyMarker;
      if (nextVersionIdMarker !== undefined) page.nextVersionIdMarker = nextVersionIdMarker;
      return page;
    },
    signal,
  );
}

/** Whether the bucket holds no object version and no delete marker (R7.1): one item at most is asked for. */
export async function isBucketEmpty(
  endpoint: string,
  bucket: string,
  signal: AbortSignal,
): Promise<boolean | NoSuchBucket> {
  const page = await listObjectVersions(endpoint, bucket, { maxKeys: 1 }, signal);
  return page === NO_SUCH_BUCKET ? page : page.items.length === 0;
}

/** An item `DeleteObjects` answered an error for, with the emulator's code and message as they came. */
export interface DeleteFailure extends ObjectVersionId {
  code: string;
  message: string;
}

/** The answer of a quiet `DeleteObjects`: the items that were not deleted. */
export interface DeleteObjectsResult {
  errors: DeleteFailure[];
}

/** Deletes `items`, each with its version id, in one quiet `DeleteObjects` (R8.3). */
export function deleteObjects(
  endpoint: string,
  bucket: string,
  items: readonly ObjectVersionId[],
  signal: AbortSignal,
): Promise<DeleteObjectsResult | NoSuchBucket> {
  return onBucket(
    endpoint,
    OPERATIONS.deleteObjects,
    (client, abortSignal) =>
      client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: items.map(({ key, versionId }) =>
              versionId === undefined ? { Key: key } : { Key: key, VersionId: versionId },
            ),
            Quiet: true,
          },
        }),
        { abortSignal },
      ),
    (output) => ({
      errors: (output.Errors ?? []).map(({ Key, VersionId, Code, Message }) => ({
        ...toItem({ Key, VersionId }),
        code: Code ?? '',
        message: Message ?? '',
      })),
    }),
    signal,
  );
}

/** What `DeleteBucket` did: the bucket is gone, or it was not deleted because it is not empty (R7.4). */
export type DeleteBucketResult = 'deleted' | 'not-empty';

export function deleteBucket(
  endpoint: string,
  bucket: string,
  signal: AbortSignal,
): Promise<DeleteBucketResult | NoSuchBucket> {
  return onBucket<unknown, DeleteBucketResult>(
    endpoint,
    OPERATIONS.deleteBucket,
    (client, abortSignal) => client.send(new DeleteBucketCommand({ Bucket: bucket }), { abortSignal }),
    () => 'deleted',
    signal,
    { code: 'BucketNotEmpty', result: 'not-empty' },
  );
}

/** "Object Ownership" (R6.4), as the API names the three settings. */
export type ObjectOwnership = 'BucketOwnerEnforced' | 'BucketOwnerPreferred' | 'ObjectWriter';

/** What `CreateBucket` is sent with (R6.4 step 2); no `LocationConstraint` is ever sent. */
export interface CreateBucketRequest {
  bucket: string;
  ownership: ObjectOwnership;
  objectLock: boolean;
  /** Sent as `CreateBucketConfiguration.Tags` only when there is one. */
  tags: Tag[];
}

export async function createBucket(
  endpoint: string,
  { bucket, ownership, objectLock, tags }: CreateBucketRequest,
  signal: AbortSignal,
): Promise<void> {
  const command = new CreateBucketCommand({
    Bucket: bucket,
    ObjectOwnership: ownership,
    ...(objectLock ? { ObjectLockEnabledForBucket: true } : {}),
    ...(tags.length === 0
      ? {}
      : { CreateBucketConfiguration: { Tags: tags.map(({ key, value }) => ({ Key: key, Value: value })) } }),
  });
  await sendRequest(
    OPERATIONS.createBucket,
    (abortSignal) => s3Client(endpoint).send(command, { abortSignal }),
    signal,
  );
}

/** The four Block Public Access settings. */
export interface PublicAccessBlock {
  blockPublicAcls: boolean;
  ignorePublicAcls: boolean;
  blockPublicPolicy: boolean;
  restrictPublicBuckets: boolean;
}

export async function putPublicAccessBlock(
  endpoint: string,
  bucket: string,
  settings: PublicAccessBlock,
  signal: AbortSignal,
): Promise<void> {
  const command = new PutPublicAccessBlockCommand({
    Bucket: bucket,
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: settings.blockPublicAcls,
      IgnorePublicAcls: settings.ignorePublicAcls,
      BlockPublicPolicy: settings.blockPublicPolicy,
      RestrictPublicBuckets: settings.restrictPublicBuckets,
    },
  });
  await sendRequest(
    OPERATIONS.putPublicAccessBlock,
    (abortSignal) => s3Client(endpoint).send(command, { abortSignal }),
    signal,
  );
}

/** `PutBucketVersioning` with the status `Enabled`. */
export async function enableBucketVersioning(endpoint: string, bucket: string, signal: AbortSignal): Promise<void> {
  const command = new PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status: 'Enabled' } });
  await sendRequest(
    OPERATIONS.putBucketVersioning,
    (abortSignal) => s3Client(endpoint).send(command, { abortSignal }),
    signal,
  );
}

/** A default encryption with a KMS key (R6.4 step 3); `bucketKey` is sent only for SSE-KMS. */
export type KmsEncryption =
  { algorithm: 'aws:kms'; kmsKeyId: string; bucketKey: boolean } | { algorithm: 'aws:kms:dsse'; kmsKeyId: string };

export async function putBucketEncryption(
  endpoint: string,
  bucket: string,
  encryption: KmsEncryption,
  signal: AbortSignal,
): Promise<void> {
  const command = new PutBucketEncryptionCommand({
    Bucket: bucket,
    ServerSideEncryptionConfiguration: {
      Rules: [
        {
          ApplyServerSideEncryptionByDefault: {
            SSEAlgorithm: encryption.algorithm,
            KMSMasterKeyID: encryption.kmsKeyId,
          },
          ...(encryption.algorithm === 'aws:kms' ? { BucketKeyEnabled: encryption.bucketKey } : {}),
        },
      ],
    },
  });
  await sendRequest(
    OPERATIONS.putBucketEncryption,
    (abortSignal) => s3Client(endpoint).send(command, { abortSignal }),
    signal,
  );
}

// Issue 480, tasks 2 and 4: one object's head, tags and body, and the deletion of keys.

/** The emulator holds no object of the key asked: `HeadObject` answered 404, or a call answered `NoSuchKey`. */
export const NO_SUCH_KEY = 'no-such-key';
export type NoSuchKey = typeof NO_SUCH_KEY;

/** `HeadObject` answered 404: a HEAD answer has no body, so a gone bucket and a gone key both arrive as this. */
export const NOT_FOUND = 'not-found';
export type NotFound = typeof NOT_FOUND;

/** One entry of an object's metadata, as the answer gave it. */
export interface MetadataEntry {
  key: string;
  value: string;
}

/** What `HeadObject` reports of an object. A value the answer did not give is absent. */
export interface ObjectHead {
  key: string;
  /** `Content-Length`, the object's size in bytes. */
  size?: number;
  contentType?: string;
  lastModified?: Date;
  etag?: string;
  /** `x-amz-storage-class`, as it came; absent when the answer has none. */
  storageClass?: string;
  versionId?: string;
  /** The system metadata the answer gave, in the order the page shows it: Content-Type, Cache-Control, … */
  system: MetadataEntry[];
  /** The user metadata (`x-amz-meta-*`), its key without the prefix, in the answer's order. */
  user: MetadataEntry[];
}

/** The code with which a call on a key says the emulator holds no object of that key. */
const NO_SUCH_KEY_CODE = 'NoSuchKey';

/** Whether a failure is the 404 of a HEAD answer: no code, or the SDK's `NotFound`, under the status 404. */
function isNotFound(error: unknown): boolean {
  const code = answeredCode(error);
  return code !== undefined && (code === 'NotFound' || code === NO_SUCH_KEY_CODE || /^HTTP 404( |$)/.test(code));
}

function toHead(key: string, output: HeadObjectCommandOutput): ObjectHead {
  const head: ObjectHead = { key, system: [], user: [] };
  const size = number(output.ContentLength);
  const contentType = text(output.ContentType);
  const etag = text(output.ETag);
  const storageClass = text(output.StorageClass);
  const versionId = text(output.VersionId);
  if (size !== undefined) head.size = size;
  if (contentType !== undefined) head.contentType = contentType;
  if (output.LastModified instanceof Date && !Number.isNaN(output.LastModified.getTime())) {
    head.lastModified = output.LastModified;
  }
  if (etag !== undefined) head.etag = etag;
  if (storageClass !== undefined) head.storageClass = storageClass;
  if (versionId !== undefined) head.versionId = versionId;
  const expires =
    text(output.ExpiresString) ??
    (output.Expires instanceof Date && !Number.isNaN(output.Expires.getTime())
      ? output.Expires.toUTCString()
      : undefined);
  const system: [string, string | undefined][] = [
    ['Content-Type', contentType],
    ['Cache-Control', text(output.CacheControl)],
    ['Content-Encoding', text(output.ContentEncoding)],
    ['Content-Disposition', text(output.ContentDisposition)],
    ['Expires', expires],
  ];
  head.system = system.flatMap(([entry, value]) => (value === undefined ? [] : [{ key: entry, value }]));
  head.user = Object.entries(output.Metadata ?? {}).map(([entry, value]) => ({ key: entry, value }));
  return head;
}

/**
 * `HeadObject` of `key` in bucket `bucket`: its properties and metadata. A 404 is `NOT_FOUND`, whether the bucket or
 * the key is gone; every other failure rejects as it came.
 */
export async function headObject(
  endpoint: string,
  bucket: string,
  key: string,
  signal: AbortSignal,
): Promise<ObjectHead | NotFound> {
  try {
    const output = await sendRequest(
      OPERATIONS.headObject,
      (abortSignal) => s3Client(endpoint).send(new HeadObjectCommand({ Bucket: bucket, Key: key }), { abortSignal }),
      signal,
    );
    return toHead(key, output);
  } catch (error) {
    if (isNotFound(error)) {
      return NOT_FOUND;
    }
    throw error;
  }
}

/** The object's tags in the answer's order (`GetObjectTagging`). */
export async function getObjectTagging(
  endpoint: string,
  bucket: string,
  key: string,
  signal: AbortSignal,
): Promise<Tag[] | NoSuchBucket | NoSuchKey> {
  try {
    const output = await sendRequest(
      OPERATIONS.getObjectTagging,
      (abortSignal) =>
        s3Client(endpoint).send(new GetObjectTaggingCommand({ Bucket: bucket, Key: key }), { abortSignal }),
      signal,
    );
    return (output.TagSet ?? []).map(({ Key, Value }) => ({ key: Key ?? '', value: Value ?? '' }));
  } catch (error) {
    const code = answeredCode(error);
    if (code === NO_SUCH_BUCKET_CODE) return NO_SUCH_BUCKET;
    if (code === NO_SUCH_KEY_CODE) return NO_SUCH_KEY;
    throw error;
  }
}

/** An object's body, or the part of it a range asked, as bytes, with the type the answer gave. */
export interface ObjectBody {
  bytes: Uint8Array;
  contentType?: string;
}

/**
 * `GetObject` of `key`: the whole body, or with `range` (`bytes=0-65535`) the part it names. Every failure, "no such
 * key" included, rejects as it came: the page asks this only of an object `HeadObject` found.
 */
export async function getObject(
  endpoint: string,
  bucket: string,
  key: string,
  signal: AbortSignal,
  range?: string,
): Promise<ObjectBody> {
  return sendRequest(
    OPERATIONS.getObject,
    async (abortSignal) => {
      const output = await s3Client(endpoint).send(
        new GetObjectCommand({ Bucket: bucket, Key: key, ...(range === undefined ? {} : { Range: range }) }),
        { abortSignal },
      );
      const bytes = output.Body === undefined ? new Uint8Array() : await output.Body.transformToByteArray();
      const contentType = text(output.ContentType);
      return contentType === undefined ? { bytes } : { bytes, contentType };
    },
    signal,
  );
}

/** One page of every key under a prefix, with no delimiter (a folder's keys, issue 480 task 4). */
export interface KeyPage {
  keys: string[];
  /** `NextContinuationToken`, while the answer is truncated. */
  nextToken?: string;
}

/** The most keys one `DeleteObjects` takes, and one page of a folder's keys asks. */
export const KEYS_PER_CALL = 1000;

/**
 * One page of every key under `prefix` (`ListObjectsV2` without a delimiter). Every failure, "no such bucket"
 * included, rejects as it came, so the dialog shows the emulator's own message.
 */
export async function listKeys(
  endpoint: string,
  bucket: string,
  prefix: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<KeyPage> {
  const output = await sendRequest(
    OPERATIONS.listObjectsV2,
    (abortSignal) =>
      s3Client(endpoint).send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          MaxKeys: KEYS_PER_CALL,
          ...(token === undefined ? {} : { ContinuationToken: token }),
        }),
        { abortSignal },
      ),
    signal,
  );
  const page: KeyPage = { keys: (output.Contents ?? []).flatMap(({ Key }) => (Key === undefined ? [] : [Key])) };
  const next = text(output.NextContinuationToken);
  if (output.IsTruncated === true && next !== undefined) {
    page.nextToken = next;
  }
  return page;
}

/** A key `DeleteObjects` refused, with the emulator's code and message as they came. */
export interface KeyRefusal {
  key: string;
  code: string;
  message: string;
}

/** What one `DeleteObjects` of keys answered: how many it deleted, and the keys it refused. */
export interface KeysDeleted {
  deleted: number;
  refused: KeyRefusal[];
}

/**
 * Deletes `keys` (at most `KEYS_PER_CALL`) in one `DeleteObjects` that is not quiet, so the answer names every key
 * deleted. Every failure of the call, "no such bucket" included, rejects as it came.
 */
export async function deleteKeys(
  endpoint: string,
  bucket: string,
  keys: readonly string[],
  signal: AbortSignal,
): Promise<KeysDeleted> {
  const output = await sendRequest(
    OPERATIONS.deleteObjects,
    (abortSignal) =>
      s3Client(endpoint).send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys.map((key) => ({ Key: key })), Quiet: false },
        }),
        { abortSignal },
      ),
    signal,
  );
  return {
    deleted: (output.Deleted ?? []).length,
    refused: (output.Errors ?? []).map(({ Key, Code, Message }) => ({
      key: Key ?? '',
      code: Code ?? '',
      message: Message ?? '',
    })),
  };
}

// Issue 480, task 3: putting files, whole or in parts, and a folder's marker.

/**
 * `PutObject` of `body` under `key`, with `contentType` when given. The body is bytes: the SDK then computes its
 * checksum from them, where a browser `Blob` would need a stream it cannot read. Every failure rejects as it came.
 */
export async function putObject(
  endpoint: string,
  bucket: string,
  key: string,
  body: Uint8Array,
  contentType: string | undefined,
  signal: AbortSignal,
): Promise<void> {
  await sendRequest(
    OPERATIONS.putObject,
    (abortSignal) =>
      s3Client(endpoint).send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ...(contentType === undefined ? {} : { ContentType: contentType }),
        }),
        { abortSignal },
      ),
    signal,
  );
}

/** `CreateMultipartUpload` of `key`: the upload's id. An answer without one rejects. */
export async function createMultipartUpload(
  endpoint: string,
  bucket: string,
  key: string,
  contentType: string | undefined,
  signal: AbortSignal,
): Promise<string> {
  const output = await sendRequest(
    OPERATIONS.createMultipartUpload,
    (abortSignal) =>
      s3Client(endpoint).send(
        new CreateMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          ...(contentType === undefined ? {} : { ContentType: contentType }),
        }),
        { abortSignal },
      ),
    signal,
  );
  const uploadId = text(output.UploadId);
  if (uploadId === undefined) {
    throw new RequestError({
      kind: 'other',
      operation: OPERATIONS.createMultipartUpload,
      code: 'NoUploadId',
      message: 'The answer named no upload id.',
    });
  }
  return uploadId;
}

/** One part put, as `CompleteMultipartUpload` names it. */
export interface UploadedPart {
  partNumber: number;
  etag: string;
}

/** `UploadPart` number `partNumber` of upload `uploadId`: the part's ETag. */
export async function uploadPart(
  endpoint: string,
  bucket: string,
  key: string,
  uploadId: string,
  partNumber: number,
  body: Uint8Array,
  signal: AbortSignal,
): Promise<UploadedPart> {
  const output = await sendRequest(
    OPERATIONS.uploadPart,
    (abortSignal) =>
      s3Client(endpoint).send(
        new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: partNumber, Body: body }),
        { abortSignal },
      ),
    signal,
  );
  return { partNumber, etag: text(output.ETag) ?? '' };
}

/** `CompleteMultipartUpload` of upload `uploadId` with its parts, in order. */
export async function completeMultipartUpload(
  endpoint: string,
  bucket: string,
  key: string,
  uploadId: string,
  parts: readonly UploadedPart[],
  signal: AbortSignal,
): Promise<void> {
  await sendRequest(
    OPERATIONS.completeMultipartUpload,
    (abortSignal) =>
      s3Client(endpoint).send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts.map(({ partNumber, etag }) => ({ PartNumber: partNumber, ETag: etag })) },
        }),
        { abortSignal },
      ),
    signal,
  );
}

/** `AbortMultipartUpload` of upload `uploadId`: the emulator drops its parts. */
export async function abortMultipartUpload(
  endpoint: string,
  bucket: string,
  key: string,
  uploadId: string,
  signal: AbortSignal,
): Promise<void> {
  await sendRequest(
    OPERATIONS.abortMultipartUpload,
    (abortSignal) =>
      s3Client(endpoint).send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }), {
        abortSignal,
      }),
    signal,
  );
}

/**
 * Whether anything is stored under `prefix` (`ListObjectsV2` with `MaxKeys` 1): a key or a common prefix. Every
 * failure, "no such bucket" included, rejects as it came.
 */
export async function holdsAnyUnder(
  endpoint: string,
  bucket: string,
  prefix: string,
  signal: AbortSignal,
): Promise<boolean> {
  const output = await sendRequest(
    OPERATIONS.listObjectsV2,
    (abortSignal) =>
      s3Client(endpoint).send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1 }), {
        abortSignal,
      }),
    signal,
  );
  return (output.Contents ?? []).length > 0 || (output.CommonPrefixes ?? []).length > 0;
}
