import type { CollectionPreferencesProps } from '@cloudscape-design/components/collection-preferences';
import { useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import '../../../styles/emulator-line.css';
import { AreaRootContext } from '../../../area-root';

// Parts the IAM screens share (issue 82): their polite announcements, the modal root of their Cloudscape dialogs
// ("Preferences", "Delete … roles?") in the area's root, and the room a table's name column keeps (issue 467).

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

/**
 * Cloudscape's modal root in the area's root, never under `document.body`, for a `Modal` or "Preferences". The two
 * functions keep their identity for the life of the page: Cloudscape's portal makes a new root, and so mounts the
 * dialog's content afresh, whenever either changes, which would drop focus and what Cloudscape holds inside it.
 */
export function useAreaModalRoot(): Required<Pick<CollectionPreferencesProps, 'getModalRoot' | 'removeModalRoot'>> {
  const root = useContext(AreaRootContext);
  return useMemo(
    () => ({
      getModalRoot: () =>
        Promise.resolve().then(() => {
          const area = root.current;
          if (area === null) {
            throw new Error('A modal of the AWS area opened outside the area.');
          }
          const container = document.createElement('div');
          area.appendChild(container);
          return container;
        }),
      removeModalRoot: (container: HTMLElement | null) => {
        container?.remove();
      },
    }),
    [root],
  );
}
