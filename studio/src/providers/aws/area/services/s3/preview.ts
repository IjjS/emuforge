// The preview of an object's body on its page (issue 480, task 2): which types are shown as text, the range read,
// and how the bytes read become text. The text is the emulator's content: rendered as text only, never stored or
// logged.

/** How many bytes of a body the preview reads: the first 64 KiB. */
export const PREVIEW_BYTES = 65_536;

/** The `Range` the preview's `GetObject` asks. */
export const PREVIEW_RANGE = `bytes=0-${String(PREVIEW_BYTES - 1)}`;

/** The types, besides `text/*` and those ending in `+json` or `+xml`, whose body is shown as text. */
const TEXT_TYPES: ReadonlySet<string> = new Set([
  'application/json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'application/javascript',
  'application/x-ndjson',
]);

/**
 * Whether a body of `contentType` is shown as text: its parameters (`; charset=…`) ignored and compared without case,
 * `text/*`, one of `TEXT_TYPES`, or a type ending in `+json` or `+xml`. An absent type is not.
 */
export function isPreviewable(contentType: string | undefined): boolean {
  if (contentType === undefined) {
    return false;
  }
  const type = (contentType.split(';', 1)[0] ?? '').trim().toLowerCase();
  if (type === '') {
    return false;
  }
  return type.startsWith('text/') || TEXT_TYPES.has(type) || type.endsWith('+json') || type.endsWith('+xml');
}

/** What the preview shows. */
export type Preview =
  /** The type is not shown as text: "No preview for this type. Download the object to open it." */
  | { kind: 'not-previewed' }
  /** The object holds no byte: "This object is empty." */
  | { kind: 'empty' }
  /** The text of the bytes read; `truncated` when the body is longer than they are, of `size` bytes. */
  | { kind: 'text'; text: string; truncated: boolean; size?: number };

/**
 * The text of `bytes`, the first bytes of a body of `size` bytes, decoded as UTF-8: a byte that is not UTF-8 is
 * U+FFFD; when the body goes on past them, a character cut at their end is left out.
 */
export function previewText(bytes: Uint8Array, size: number | undefined): Preview {
  const truncated = size === undefined ? bytes.length >= PREVIEW_BYTES : size > bytes.length;
  // Decoded as a stream that does not end, an incomplete sequence at the end is held back, never shown as U+FFFD.
  const text = new TextDecoder('utf-8').decode(bytes, { stream: truncated });
  if (!truncated && bytes.length === 0) {
    return { kind: 'empty' };
  }
  return size === undefined ? { kind: 'text', text, truncated } : { kind: 'text', text, truncated, size };
}

/** What the preview knows of the object before it reads: `HeadObject`'s type and size. */
export interface PreviewSubject {
  contentType?: string;
  size?: number;
}

/**
 * The preview of an object: nothing is read for a type not shown as text or a size of 0; otherwise `readRange` is
 * asked for `PREVIEW_RANGE` and its bytes decoded.
 */
export async function loadPreview(
  { contentType, size }: PreviewSubject,
  readRange: (range: string) => Promise<Uint8Array>,
): Promise<Preview> {
  if (!isPreviewable(contentType)) {
    return { kind: 'not-previewed' };
  }
  if (size === 0) {
    return { kind: 'empty' };
  }
  const bytes = await readRange(PREVIEW_RANGE);
  // An emulator that sent more than the range asked: only the range is shown.
  return previewText(bytes.length > PREVIEW_BYTES ? bytes.subarray(0, PREVIEW_BYTES) : bytes, size);
}
