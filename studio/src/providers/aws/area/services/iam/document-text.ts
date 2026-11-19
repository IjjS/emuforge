// The text of a policy document (issue 535, design "The calls"): as the emulator returns it, percent-encoded once;
// whether a text is one JSON value, the one check Studio makes before sending a document; a JSON text indented for
// reading (the trust policy alone, which the emulator returns compact); and the skeleton a new document starts from.
// A document is untrusted text from the emulator or the user, and is only ever read, never interpreted beyond this.

/** A document as the emulator returns it, percent-decoded once; as it came when it cannot be; empty when absent. */
export function decodeDocument(document: string | undefined): string {
  if (document === undefined) {
    return '';
  }
  try {
    return decodeURIComponent(document);
  } catch {
    return document;
  }
}

/** `text` is one JSON value (an object, a list, a string, a number, …), white space around it allowed. */
export function isOneJsonValue(text: string): boolean {
  if (text.trim() === '') {
    return false;
  }
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** A JSON text indented by two spaces; a text that is not JSON as it came. */
export function indentJson(text: string): string {
  if (!isOneJsonValue(text)) {
    return text;
  }
  return JSON.stringify(JSON.parse(text) as unknown, null, 2);
}

/**
 * The skeleton a new document starts from (requirement, "The skeleton"): a form to fill, not a policy the emulator
 * is claimed to accept as it is.
 */
export const POLICY_SKELETON = JSON.stringify(
  {
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Action: [], Resource: '*' }],
  },
  null,
  2,
);
