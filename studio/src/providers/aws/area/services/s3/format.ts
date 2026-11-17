import { AWS_PATH } from '../../../identity';

// The routes the bucket list's controls lead to (issue 56, requirement R6). Its creation dates are written by the
// area's shared `components/format-date.ts` (issue 386, R7).

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

/** "Empty" for a bucket. */
export function emptyBucketPath(name: string): string {
  return `${S3_PATH}/bucket/${segment(name)}/empty`;
}

/** "Delete" for a bucket. */
export function deleteBucketPath(name: string): string {
  return `${S3_PATH}/bucket/${segment(name)}/delete`;
}
