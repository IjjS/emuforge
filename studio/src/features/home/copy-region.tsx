import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { CopyAnnouncerContext } from './copy-context';

/** How long an outcome stays in the copy region; cleared after, so a second copy is announced again. */
export const COPY_SAID_MS = 3_000;

/**
 * The polite region that announces "Command copied" or "Command not copied" for every command inside `children`. It
 * is its own element, beside the notices and never inside one; each outcome is a new node, so a repeat is heard.
 */
export function CopyRegion({ children }: { children: ReactNode }) {
  const [said, setSaid] = useState<{ text: string; count: number }>({ text: '', count: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const announce = useCallback((text: string) => {
    clearTimeout(timer.current);
    setSaid((was) => ({ text, count: was.count + 1 }));
    timer.current = setTimeout(() => {
      setSaid((was) => ({ ...was, text: '' }));
    }, COPY_SAID_MS);
  }, []);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );
  return (
    <CopyAnnouncerContext value={announce}>
      {children}
      <div className="st-sr" aria-live="polite" aria-atomic="true">
        {said.text !== '' && <span key={said.count}>{said.text}</span>}
      </div>
    </CopyAnnouncerContext>
  );
}
