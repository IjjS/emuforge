// Values that must never reach a log, a verdict file or the test output: the keys and certificate lines of every
// emulator a check has seen, and every session token a check has read. Everything support writes passes through
// `redact` first, and the verdict written for a check is redacted too, so a defective app or engine that echoes a
// key cannot make the harness print it.

const secrets: string[] = [];

export const REDACTED = '[redacted]';

/** Remembers values to be redacted from everything support writes from now on. */
export function register(values: Iterable<string>): void {
  for (const value of values) {
    if (value !== '' && !secrets.includes(value)) secrets.push(value);
  }
  // Longest first, so a value that contains another is replaced whole.
  secrets.sort((a, b) => b.length - a.length);
}

/** The text with every registered value replaced by `[redacted]`. */
export function redact(text: string): string {
  let out = text;
  for (const secret of secrets) {
    if (out.includes(secret)) out = out.split(secret).join(REDACTED);
  }
  return out;
}
