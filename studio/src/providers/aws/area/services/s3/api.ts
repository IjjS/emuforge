import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  GetBucketAbacCommand,
  GetBucketAccelerateConfigurationCommand,
  GetBucketEncryptionCommand,
  GetBucketLoggingCommand,
  GetBucketNotificationConfigurationCommand,
  GetBucketRequestPaymentCommand,
  GetBucketTaggingCommand,
  GetBucketVersioningCommand,
  GetBucketWebsiteCommand,
  GetObjectLockConfigurationCommand,
  ListBucketIntelligentTieringConfigurationsCommand,
  ListBucketsCommand,
  ListObjectVersionsCommand,
  PutBucketEncryptionCommand,
  PutBucketVersioningCommand,
  PutPublicAccessBlockCommand,
  type FilterRule,
  type GetBucketNotificationConfigurationCommandOutput,
  type IntelligentTieringConfiguration,
  type ListBucketsCommandOutput,
  type S3Client,
} from '@aws-sdk/client-s3';

import { createS3Client } from '../../../../../lib/aws/client-factory';
import { RequestError, sendRequest } from '../../../../../lib/aws/request';
import type { RetentionPeriod } from './format';

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
  getBucketAbac: 'GetBucketAbac',
  getBucketTagging: 'GetBucketTagging',
  getBucketEncryption: 'GetBucketEncryption',
  listBucketIntelligentTieringConfigurations: 'ListBucketIntelligentTieringConfigurations',
  getBucketLogging: 'GetBucketLogging',
  getBucketNotificationConfiguration: 'GetBucketNotificationConfiguration',
  getBucketAccelerateConfiguration: 'GetBucketAccelerateConfiguration',
  getObjectLockConfiguration: 'GetObjectLockConfiguration',
  getBucketRequestPayment: 'GetBucketRequestPayment',
  getBucketWebsite: 'GetBucketWebsite',
  listObjectVersions: 'ListObjectVersions',
  deleteObjects: 'DeleteObjects',
  deleteBucket: 'DeleteBucket',
  createBucket: 'CreateBucket',
  putPublicAccessBlock: 'PutPublicAccessBlock',
  putBucketVersioning: 'PutBucketVersioning',
  putBucketEncryption: 'PutBucketEncryption',
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

/** "Enabled", "Suspended" or "Disabled": the status of Bucket Versioning or of Transfer acceleration. */
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

/** "Bucket ABAC" (R5.3), "Enabled" or "Disabled" as the answer says; absent when it says nothing. */
export interface AbacSetting {
  status?: string;
}

export function getBucketAbac(
  endpoint: string,
  bucket: string,
  signal: AbortSignal,
): Promise<AbacSetting | NoSuchBucket> {
  return onBucket(
    endpoint,
    OPERATIONS.getBucketAbac,
    (client, abortSignal) => client.send(new GetBucketAbacCommand({ Bucket: bucket }), { abortSignal }),
    (output) => {
      const status = text(output.AbacStatus?.Status);
      return status === undefined ? {} : { status };
    },
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

/** One row of "S3 Intelligent-Tiering Archive configurations" (R5.3). */
export interface TieringConfiguration {
  /** "Name", `Id`. */
  name?: string;
  status?: string;
  /** `Filter.Prefix`, or `Filter.And.Prefix`. */
  prefix?: string;
  /** "Archive Access tier": the `Days` of the tiering `ARCHIVE_ACCESS`. */
  archiveDays?: number;
  /** "Deep Archive Access tier": the `Days` of the tiering `DEEP_ARCHIVE_ACCESS`. */
  deepArchiveDays?: number;
}

/** The first answer of the configurations; `more` when it is truncated. */
export interface TieringConfigurations {
  configurations: TieringConfiguration[];
  more: boolean;
}

function toTiering({ Id, Status, Filter, Tierings }: IntelligentTieringConfiguration): TieringConfiguration {
  const days = (tier: string) => number(Tierings?.find(({ AccessTier }) => AccessTier === tier)?.Days);
  const configuration: TieringConfiguration = {};
  const name = text(Id);
  const status = text(Status);
  const prefix = text(Filter?.Prefix) ?? text(Filter?.And?.Prefix);
  const archiveDays = days('ARCHIVE_ACCESS');
  const deepArchiveDays = days('DEEP_ARCHIVE_ACCESS');
  if (name !== undefined) configuration.name = name;
  if (status !== undefined) configuration.status = status;
  if (prefix !== undefined) configuration.prefix = prefix;
  if (archiveDays !== undefined) configuration.archiveDays = archiveDays;
  if (deepArchiveDays !== undefined) configuration.deepArchiveDays = deepArchiveDays;
  return configuration;
}

export function listBucketIntelligentTieringConfigurations(
  endpoint: string,
  bucket: string,
  signal: AbortSignal,
): Promise<TieringConfigurations | NoSuchBucket> {
  return onBucket(
    endpoint,
    OPERATIONS.listBucketIntelligentTieringConfigurations,
    (client, abortSignal) =>
      client.send(new ListBucketIntelligentTieringConfigurationsCommand({ Bucket: bucket }), { abortSignal }),
    (output) => ({
      configurations: (output.IntelligentTieringConfigurationList ?? []).map(toTiering),
      more: output.IsTruncated === true,
    }),
    signal,
  );
}

/** "Server access logging" (R5.3). */
export interface LoggingSetting {
  status: 'Enabled' | 'Disabled';
  targetBucket?: string;
  targetPrefix?: string;
}

export function getBucketLogging(
  endpoint: string,
  bucket: string,
  signal: AbortSignal,
): Promise<LoggingSetting | NoSuchBucket> {
  return onBucket(
    endpoint,
    OPERATIONS.getBucketLogging,
    (client, abortSignal) => client.send(new GetBucketLoggingCommand({ Bucket: bucket }), { abortSignal }),
    ({ LoggingEnabled }): LoggingSetting => {
      if (LoggingEnabled === undefined) {
        return { status: 'Disabled' };
      }
      const targetBucket = text(LoggingEnabled.TargetBucket);
      const targetPrefix = text(LoggingEnabled.TargetPrefix);
      return {
        status: 'Enabled',
        ...(targetBucket === undefined ? {} : { targetBucket }),
        ...(targetPrefix === undefined ? {} : { targetPrefix }),
      };
    },
    signal,
  );
}

/** One row of "Event notifications" (R5.3). */
export interface EventNotification {
  /** "Event name", `Id`. */
  name?: string;
  /** "Event types", `Events` in the answer's order. */
  events: string[];
  prefix?: string;
  suffix?: string;
  destinationType: 'SNS topic' | 'SQS queue' | 'Lambda function';
  /** "Destination", the ARN. */
  destination?: string;
}

/** "Event notifications" and "Amazon EventBridge", from one answer. */
export interface NotificationSettings {
  notifications: EventNotification[];
  /** "Send notifications to Amazon EventBridge for all events in this bucket". */
  eventBridge: 'On' | 'Off';
}

interface NotificationConfiguration {
  Id?: string | undefined;
  Events?: string[] | undefined;
  Filter?: { Key?: { FilterRules?: FilterRule[] | undefined } | undefined } | undefined;
}

function toNotification(
  { Id, Events, Filter }: NotificationConfiguration,
  destinationType: EventNotification['destinationType'],
  arn: string | undefined,
): EventNotification {
  const rule = (name: string) =>
    text(Filter?.Key?.FilterRules?.find((filterRule) => filterRule.Name?.toLowerCase() === name)?.Value);
  const notification: EventNotification = { events: (Events ?? []).filter((event) => event !== ''), destinationType };
  const eventName = text(Id);
  const prefix = rule('prefix');
  const suffix = rule('suffix');
  const destination = text(arn);
  if (eventName !== undefined) notification.name = eventName;
  if (prefix !== undefined) notification.prefix = prefix;
  if (suffix !== undefined) notification.suffix = suffix;
  if (destination !== undefined) notification.destination = destination;
  return notification;
}

function toNotifications(output: GetBucketNotificationConfigurationCommandOutput): NotificationSettings {
  return {
    notifications: [
      ...(output.TopicConfigurations ?? []).map((c) => toNotification(c, 'SNS topic', c.TopicArn)),
      ...(output.QueueConfigurations ?? []).map((c) => toNotification(c, 'SQS queue', c.QueueArn)),
      ...(output.LambdaFunctionConfigurations ?? []).map((c) =>
        toNotification(c, 'Lambda function', c.LambdaFunctionArn),
      ),
    ],
    eventBridge: output.EventBridgeConfiguration === undefined ? 'Off' : 'On',
  };
}

export function getBucketNotificationConfiguration(
  endpoint: string,
  bucket: string,
  signal: AbortSignal,
): Promise<NotificationSettings | NoSuchBucket> {
  return onBucket(
    endpoint,
    OPERATIONS.getBucketNotificationConfiguration,
    (client, abortSignal) =>
      client.send(new GetBucketNotificationConfigurationCommand({ Bucket: bucket }), { abortSignal }),
    toNotifications,
    signal,
  );
}

/** "Transfer acceleration" (R5.3): "Disabled" when the answer has no `Status`. */
export function getBucketAccelerateConfiguration(
  endpoint: string,
  bucket: string,
  signal: AbortSignal,
): Promise<StatusSetting | NoSuchBucket> {
  return onBucket(
    endpoint,
    OPERATIONS.getBucketAccelerateConfiguration,
    (client, abortSignal) =>
      client.send(new GetBucketAccelerateConfigurationCommand({ Bucket: bucket }), { abortSignal }),
    (output) => ({ status: text(output.Status) ?? 'Disabled' }),
    signal,
  );
}

/** "Object Lock" (R5.3). */
export interface ObjectLockSetting {
  /** "Enabled" as the answer says, "Disabled" when the bucket has no configuration; absent when it says nothing. */
  status?: string;
  /** "Default retention": "Enabled" when the answer has a default retention. */
  defaultRetention: 'Enabled' | 'Disabled';
  /** "Retention mode": "Governance", "Compliance", or another mode as it came. */
  mode?: string;
  /** "Default retention period". */
  period?: RetentionPeriod;
}

const RETENTION_MODES: Readonly<Record<string, string>> = { GOVERNANCE: 'Governance', COMPLIANCE: 'Compliance' };

export function getObjectLockConfiguration(
  endpoint: string,
  bucket: string,
  signal: AbortSignal,
): Promise<ObjectLockSetting | NoSuchBucket> {
  return onBucket(
    endpoint,
    OPERATIONS.getObjectLockConfiguration,
    (client, abortSignal) => client.send(new GetObjectLockConfigurationCommand({ Bucket: bucket }), { abortSignal }),
    ({ ObjectLockConfiguration }): ObjectLockSetting => {
      const status = text(ObjectLockConfiguration?.ObjectLockEnabled);
      const retention = ObjectLockConfiguration?.Rule?.DefaultRetention;
      const setting: ObjectLockSetting = {
        ...(status === undefined ? {} : { status }),
        defaultRetention: retention === undefined ? 'Disabled' : 'Enabled',
      };
      const mode = text(retention?.Mode);
      if (mode !== undefined) {
        setting.mode = Object.hasOwn(RETENTION_MODES, mode) ? (RETENTION_MODES[mode] as string) : mode;
      }
      const days = number(retention?.Days);
      const years = number(retention?.Years);
      if (days !== undefined) {
        setting.period = { unit: 'days', count: days };
      } else if (years !== undefined) {
        setting.period = { unit: 'years', count: years };
      }
      return setting;
    },
    signal,
    { code: 'ObjectLockConfigurationNotFoundError', result: { status: 'Disabled', defaultRetention: 'Disabled' } },
  );
}

/** "Requester pays" (R5.3): "Enabled" for `Requester`, "Disabled" for `BucketOwner`, another payer as it came. */
export interface RequestPaymentSetting {
  status?: string;
}

const PAYERS: Readonly<Record<string, string>> = { Requester: 'Enabled', BucketOwner: 'Disabled' };

export function getBucketRequestPayment(
  endpoint: string,
  bucket: string,
  signal: AbortSignal,
): Promise<RequestPaymentSetting | NoSuchBucket> {
  return onBucket(
    endpoint,
    OPERATIONS.getBucketRequestPayment,
    (client, abortSignal) => client.send(new GetBucketRequestPaymentCommand({ Bucket: bucket }), { abortSignal }),
    (output) => {
      const payer = text(output.Payer);
      if (payer === undefined) {
        return {};
      }
      return { status: Object.hasOwn(PAYERS, payer) ? (PAYERS[payer] as string) : payer };
    },
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
