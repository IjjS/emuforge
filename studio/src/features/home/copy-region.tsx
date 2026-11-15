import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { useLanguage } from '../../i18n/language-context';
import { COPY_SAID, CopyAnnouncerContext, type CopyOutcome } from './copy-context';

/** How long an outcome stays in the copy region; cleared after, so a second copy is announced again. */
export const COPY_SAID_MS = 3_000;

/**
 * The polite region that announces "Command copied" or "Command not copied" for every command inside `children`. It
 * is its own element, beside the notices and never inside one; each outcome is a new node, so a repeat is heard.
 */
export function CopyRegion({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  // The outcome, not its text, so a change of language words it anew (requirement R2.7).
  const [said, setSaid] = useState<{ outcome: CopyOutcome | undefined; count: number }>({
    outcome: undefined,
    count: 0,
  });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const announce = useCallback((outcome: CopyOutcome) => {
    clearTimeout(timer.current);
    setSaid((was) => ({ outcome, count: was.count + 1 }));
    timer.current = setTimeout(() => {
      setSaid((was) => ({ ...was, outcome: undefined }));
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
        {said.outcome !== undefined && <span key={said.count}>{t(COPY_SAID[said.outcome])}</span>}
      </div>
    </CopyAnnouncerContext>
  );
}
