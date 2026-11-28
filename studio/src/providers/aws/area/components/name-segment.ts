const LINE_BREAK_SEGMENT_PREFIX = '**';
export const LINE_BREAK = /\r\n|[\r\n\u2028\u2029]/;
const LINE_BREAKS = new RegExp(LINE_BREAK, 'g');

export function nameSegment(name: string): string {
  if (name === '.' || name === '..') return `*${name}`;
  const encoded = encodeURIComponent(name);
  // React Router decodes the path for matching, and its splat excludes the four JavaScript line terminators.
  return LINE_BREAK.test(name) ? `${LINE_BREAK_SEGMENT_PREFIX}${encodeURIComponent(encoded)}` : encoded;
}

/** The area has already percent-decoded the parameter once. */
export function nameFromSegment(segment: string): string {
  if (segment.startsWith(LINE_BREAK_SEGMENT_PREFIX)) {
    try {
      return decodeURIComponent(segment.slice(LINE_BREAK_SEGMENT_PREFIX.length));
    } catch {
      return segment;
    }
  }
  return segment.startsWith('*') ? segment.slice(1) : segment;
}

export function normalizeLineBreaks(name: string): string {
  return name.replace(LINE_BREAKS, '\n');
}
