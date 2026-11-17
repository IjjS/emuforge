import './value-text.css';

import type { ReactNode } from 'react';

// A value from the emulator or the user as text that breaks where it can be read (issue 467, requirement R6;
// `studio/AGENTS.md`, "What every AWS screen does", entry 4). A page states for each value which of the four kinds it
// is. The value is rendered as text, character for character; the only elements added are the boxes and `<wbr>`s that
// say where it may break, which add no character, so selecting it copies exactly the value.

/**
 * The four kinds of value:
 * - `address`: an ARN, a URL, a path; breaks only directly after `:` or `/` (and `?`, `&`);
 * - `name`: a resource's name, a key, an id; whole on one line where it fits, anywhere when longer;
 * - `fixed`: a status, an enumerated value, a Region, a date, a number; never inside a word;
 * - `text`: a description, a reason, a message, a tag's value; at spaces.
 */
export type ValueKind = 'address' | 'name' | 'fixed' | 'text';

/** The class each kind's element carries; every one also carries `aws-area-value`. */
export const VALUE_CLASS: Readonly<Record<ValueKind, string>> = {
  address: 'aws-area-value-address',
  name: 'aws-area-value-name',
  fixed: 'aws-area-value-fixed',
  text: 'aws-area-value-text',
};

/** The characters an address may break directly after. */
const ADDRESS_BREAKS = /[^:/?&]*[:/?&]|[^:/?&]+$/g;

/** An address's parts, each but the last ending with one of `:`, `/`, `?` and `&`. */
export function addressParts(value: string): string[] {
  return value.match(ADDRESS_BREAKS) ?? [];
}

interface ValueTextProps {
  kind: ValueKind;
  /** The value; `undefined`, `null` or empty shows `none` instead. */
  value: string | null | undefined;
  /** What stands in the value's place when there is none, as the caller writes "no value" ("-"); nothing if omitted. */
  none?: ReactNode;
}

/** One value of `kind`, broken the area's one way (R6). */
export function ValueText({ kind, value, none = null }: ValueTextProps) {
  if (value === undefined || value === null || value === '') {
    return <>{none}</>;
  }
  const className = `aws-area-value ${VALUE_CLASS[kind]}`;
  switch (kind) {
    case 'address': {
      const parts = addressParts(value);
      return (
        <span className={className}>
          {parts.map((part, index) => (
            // The parts of one value never move, so their place is their identity.
            <AddressPart key={index} part={part} last={index === parts.length - 1} />
          ))}
        </span>
      );
    }
    case 'fixed':
      return (
        <span className={className}>
          {value.split(/(\s+)/).map((piece, index) =>
            /^\s*$/.test(piece) ? (
              piece
            ) : (
              <span key={index} className="aws-area-value-whole">
                {piece}
              </span>
            ),
          )}
        </span>
      );
    case 'name':
    case 'text':
      return <span className={className}>{value}</span>;
  }
}

/** One part of an address, and the break opportunity after it unless it is the last. */
function AddressPart({ part, last }: { part: string; last: boolean }) {
  return (
    <>
      <span className="aws-area-value-part">{part}</span>
      {!last && <wbr />}
    </>
  );
}
