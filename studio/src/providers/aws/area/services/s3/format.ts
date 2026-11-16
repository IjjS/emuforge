import { AWS_PATH } from '../../../identity';

// How the bucket list writes a creation date (issue 56, requirement R4.2) and the routes its controls lead to (R6).

/** Shown for a bucket whose answer gave no creation date. */
export const NO_DATE = '-';

const PARTS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'longOffset',
};

/** `GMT+09:00`, `GMT-02:30` or `GMT` (a zero offset), as `longOffset` writes it, in the console's `UTC±hh:mm`. */
function utcOffset(gmt: string): string {
  const offset = gmt.replace(/^GMT/, '');
  return `UTC${offset === '' ? '+00:00' : offset}`;
}

/**
 * A creation date as the console writes it, in `timeZone` (the browser's when omitted): "October 30, 2026, 23:18:34
 * (UTC+09:00)", English month, 24-hour clock, the zone's offset at that instant. "-" for none.
 */
export function creationDateText(date: Date | undefined, timeZone?: string): string {
  if (date === undefined || Number.isNaN(date.getTime())) {
    return NO_DATE;
  }
  const format = new Intl.DateTimeFormat('en-US', timeZone === undefined ? PARTS : { ...PARTS, timeZone });
  const part = Object.fromEntries(format.formatToParts(date).map(({ type, value }) => [type, value]));
  const value = (type: Intl.DateTimeFormatPartTypes) => part[type] ?? '';
  return `${value('month')} ${value('day')}, ${value('year')}, ${value('hour')}:${value('minute')}:${value('second')} (${utcOffset(value('timeZoneName'))})`;
}

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
