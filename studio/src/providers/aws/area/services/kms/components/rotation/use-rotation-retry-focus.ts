import { useCallback, useLayoutEffect, useRef } from 'react';

/** If a read removes the focused Retry, resume keyboard navigation at that panel's heading. */
export function useRotationRetryFocus() {
  const heading = useRef<HTMLSpanElement>(null);
  const removedFocusedRetry = useRef(false);
  const retryRegion = useCallback((region: HTMLDivElement | null) => {
    if (region === null) return;
    return () => {
      const focused = region.ownerDocument.activeElement;
      removedFocusedRetry.current = focused instanceof HTMLButtonElement && region.contains(focused);
    };
  }, []);

  useLayoutEffect(() => {
    if (!removedFocusedRetry.current) return;
    removedFocusedRetry.current = false;
    const target = heading.current;
    if (target === null || target.ownerDocument.activeElement !== target.ownerDocument.body) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  });

  return { heading, retryRegion };
}
