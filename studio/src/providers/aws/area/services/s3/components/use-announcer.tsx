import { useCallback, useState, type ReactNode } from 'react';

import '../../../styles/emulator-line.css';

/**
 * The polite announcements of a page of S3 (issue 256, R5.6, R11.2): the region to render, and the function that
 * says a text in it. Each text is a new element, so the same text is said again.
 */
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
