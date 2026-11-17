// How the area writes a date as the console does (issue 56, requirement R4.2), shared by every service of the area
// (issue 386, R7); moved here unchanged from the S3 folder.

/** Shown for no date, as for a bucket whose answer gave none. */
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
