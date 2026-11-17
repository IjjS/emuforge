import CopyToClipboard from '@cloudscape-design/components/copy-to-clipboard';
import type { ReactNode } from 'react';

import { ValueText, type ValueKind } from './value-text';

// A value a user takes to another tool (an ARN, a URL, an id the emulator assigned) with its copy control (issue 467,
// requirement R5; `studio/AGENTS.md`, "What every AWS screen does", entry 3): Cloudscape's `CopyToClipboard`,
// variant `inline`, an icon button directly before the value's text. The value inside is the area's own element,
// which decides its own breaking (`value-text.tsx`); no Cloudscape internal is restyled. The popover is rendered in
// place, inside the area, never through a portal.

interface CopyValueProps {
  /** The field's label, as the page shows it: the button is "Copy {label}". */
  label: string;
  /** The value exactly as the emulator gave it; `undefined`, `null` or empty shows `none` and no control. */
  value: string | null | undefined;
  /** How the value breaks; an ARN or a URL is an address. */
  kind?: ValueKind;
  /** What stands in the value's place when there is none ("-"); nothing if omitted. */
  none?: ReactNode;
}

/** "Copy {label}", and what a press shows: "{label} copied" or "{label} could not be copied". */
function copyTexts(label: string): { button: string; copied: string; notCopied: string } {
  return { button: `Copy ${label}`, copied: `${label} copied`, notCopied: `${label} could not be copied` };
}

/** One value with its copy control; an absent value has none. */
export function CopyValue({ label, value, kind = 'address', none = null }: CopyValueProps) {
  if (value === undefined || value === null || value === '') {
    return <>{none}</>;
  }
  const texts = copyTexts(label);
  return (
    <CopyToClipboard
      variant="inline"
      textToCopy={value}
      textToDisplay={<ValueText kind={kind} value={value} />}
      copyButtonAriaLabel={texts.button}
      copySuccessText={texts.copied}
      copyErrorText={texts.notCopied}
      popoverRenderWithPortal={false}
    />
  );
}
