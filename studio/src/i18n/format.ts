// Times and numbers of Studio's own layer in the current language (requirement R5.3, R5.4). Ports, addresses and HTTP
// status codes are literal text and are never formatted here: they go into a message as the text they are.

const TIMES = new Map<string, Intl.DateTimeFormat>();
const NUMBERS = new Map<string, Intl.NumberFormat>();

function timeFormat(tag: string): Intl.DateTimeFormat {
  let format = TIMES.get(tag);
  if (format === undefined) {
    format = new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    TIMES.set(tag, format);
  }
  return format;
}

function numberFormat(tag: string): Intl.NumberFormat {
  let format = NUMBERS.get(tag);
  if (format === undefined) {
    format = new Intl.NumberFormat(tag);
    NUMBERS.set(tag, format);
  }
  return format;
}

/** The local time of `at` (milliseconds since the epoch) in `tag`: hour 00 to 23, minute and second (R5.3). */
export function formatTime(tag: string, at: number): string {
  return timeFormat(tag).format(new Date(at));
}

/** A count or a duration in `tag` (R5.4): `1.234` in German. */
export function formatNumber(tag: string, value: number): string {
  return numberFormat(tag).format(value);
}
