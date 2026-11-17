import type { CollectionPreferencesProps } from '@cloudscape-design/components/collection-preferences';
import { useCallback, useContext, useState, type ReactNode } from 'react';

import '../../../styles/emulator-line.css';
import { AreaRootContext } from '../../../area-root';

// Parts the IAM screens share (issue 82): their polite announcements and the modal root of Cloudscape's
// "Preferences" in the area's root.

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

/** Cloudscape's modal root for "Preferences" in the area's root, never under `document.body` (`AreaModal`). */
export function useAreaModalRoot(): Pick<CollectionPreferencesProps, 'getModalRoot' | 'removeModalRoot'> {
  const root = useContext(AreaRootContext);
  return {
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
  };
}
