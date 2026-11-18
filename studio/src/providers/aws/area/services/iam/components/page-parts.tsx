import { useCallback, useState, type ReactNode } from 'react';

import '../../../styles/emulator-line.css';

// Parts the IAM screens share (issue 82): their polite announcements and the room a table's name column keeps (issue
// 467). Their dialogs take the area's modal root (`components/area-modal.tsx`, issue 462).

/**
 * The room a table's name column keeps, so a name of up to 24 characters is on one line at 1280 and 390 wide (issue
 * 467, requirement R6): 24 characters of the cell's text and the cell's own padding, in the text's own unit.
 */
export const NAME_COLUMN_MIN_WIDTH = '28ch';

/** The polite announcements of a page (R8, R10.2): each one a new element, so the same text is said again. */
export function useAnnouncer(): [ReactNode, (text: string) => void] {
  const [said, setSaid] = useState({ text: '', id: 0 });
  const announce = useCallback((text: string) => {
    setSaid((current) => ({ text, id: current.id + 1 }));
  }, []);
  const region = (
    // The area's visually hidden live region, as the emulator line's.
    <div className="aws-area-announcer" aria-live="polite" aria-atomic="true">
      {said.text !== '' && <span key={said.id}>{said.text}</span>}
    </div>
  );
  return [region, announce];
}
