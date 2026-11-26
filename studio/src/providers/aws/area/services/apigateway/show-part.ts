import { useCallback, useRef } from 'react';
import { useLocation } from 'react-router';

/** Attach to a section's heading and give that heading tabIndex={-1}. */
export function useShowPart(part: string): (heading: HTMLElement | null) => void {
  const { key, search } = useLocation();
  const show = new URLSearchParams(search).get('show');
  const focused = useRef<string | undefined>(undefined);

  return useCallback(
    (heading) => {
      if (heading !== null && show === part && focused.current !== key) {
        focused.current = key;
        heading.scrollIntoView?.({ block: 'start' });
        heading.focus({ preventScroll: true });
      }
    },
    [key, part, show],
  );
}
