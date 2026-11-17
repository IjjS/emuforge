import { AWS_PATH } from '../../../identity';

// The routes of S3's screens and the words S3's values are shown in (issue 56, requirement R6; issue 256,
// requirement R0, R5.3, R10). Creation dates are written by the area's shared `components/format-date.ts`
// (issue 386, R7).

/** S3's route in the area, `/aws/s3`. */
export const S3_PATH = `${AWS_PATH}/s3`;

/** The general purpose bucket list. */
export const BUCKETS_PATH = `${S3_PATH}/buckets`;

/** The directory bucket list, the tab "Directory buckets". */
export const DIRECTORY_BUCKETS_PATH = `${S3_PATH}/directory-buckets`;

/** "Create bucket". */
export const CREATE_BUCKET_PATH = `${S3_PATH}/bucket/create`;

/** A bucket's name as one path segment: percent-encoded, so a space, "%" or "/" cannot change the route. */
function segment(name: string): string {
  return encodeURIComponent(name);
}

/** A bucket's own page, the link of its name. */
export function bucketPath(name: string): string {
  return `${BUCKETS_PATH}/${segment(name)}`;
}

/** The tabs of a bucket's page but "Properties", each a route of its own (R10). */
export type BucketTab = 'objects' | 'metadata' | 'permissions' | 'metrics' | 'management';

/** The tab "Properties" of a bucket's page. */
export function bucketPropertiesPath(name: string): string {
  return `${bucketPath(name)}/properties`;
}

/** Another tab of a bucket's page. */
export function bucketTabPath(name: string, tab: BucketTab): string {
  return `${bucketPath(name)}/${tab}`;
}

/** The sections of a bucket's "Properties" whose button is "Edit" (R10). */
export type EditableProperty =
  | 'versioning'
  | 'abac'
  | 'tags'
  | 'encryption'
  | 'logging'
  | 'eventbridge'
  | 'transfer-acceleration'
  | 'object-lock'
  | 'requester-pays'
  | 'website';

/** The route of a section's "Edit". */
export function editPropertyPath(name: string, property: EditableProperty): string {
  return `${S3_PATH}/bucket/${segment(name)}/property/${property}/edit`;
}

/** "Create configuration" of "S3 Intelligent-Tiering Archive configurations". */
export function createIntelligentTieringPath(name: string): string {
  return `${S3_PATH}/bucket/${segment(name)}/property/intelligent-tiering/create`;
}

/** "Create event notification" of "Event notifications". */
export function createEventNotificationPath(name: string): string {
  return `${S3_PATH}/bucket/${segment(name)}/property/event-notification/create`;
}

/** "Empty" for a bucket. */
export function emptyBucketPath(name: string): string {
  return `${S3_PATH}/bucket/${segment(name)}/empty`;
}

/** "Delete" for a bucket. */
export function deleteBucketPath(name: string): string {
  return `${S3_PATH}/bucket/${segment(name)}/delete`;
}

/** The console's names of the three encryption types, by the algorithm the API names them with (R5.3). */
const ENCRYPTION_TYPES: Readonly<Record<string, string>> = {
  AES256: 'Server-side encryption with Amazon S3 managed keys (SSE-S3)',
  'aws:kms': 'Server-side encryption with AWS Key Management Service keys (SSE-KMS)',
  'aws:kms:dsse': 'Dual-layer server-side encryption with AWS Key Management Service (AWS KMS) keys (DSSE-KMS)',
};

/** "Encryption type" for a default encryption's algorithm; an algorithm of no type here as it came. */
export function encryptionTypeLabel(algorithm: string): string {
  return Object.hasOwn(ENCRYPTION_TYPES, algorithm) ? (ENCRYPTION_TYPES[algorithm] as string) : algorithm;
}

/** A number of days: "1 day", "90 days". */
export function formatDays(days: number): string {
  return days === 1 ? '1 day' : `${String(days)} days`;
}

/** A number of years: "1 year", "2 years". */
export function formatYears(years: number): string {
  return years === 1 ? '1 year' : `${String(years)} years`;
}

/** A period of Object Lock's default retention, in the unit it was set in. */
export type RetentionPeriod = { unit: 'days'; count: number } | { unit: 'years'; count: number };

/** "Default retention period". */
export function formatRetentionPeriod(period: RetentionPeriod): string {
  return period.unit === 'days' ? formatDays(period.count) : formatYears(period.count);
}
