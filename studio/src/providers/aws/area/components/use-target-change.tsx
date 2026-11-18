import Box from '@cloudscape-design/components/box';
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

import type { FlashResult } from './page-flash';

/** The flash's text of a change of target (issue 486, R3), the target's name in code style. */
export function targetChangedResult(target: string): FlashResult {
  return [
    {
      type: 'info',
      content: (
        <>
          The target is now{' '}
          <Box variant="code" display="inline">
            {target}
          </Box>
          . This page was read again from its emulator.
        </>
      ),
    },
  ];
}

interface TargetChange {
  /** Studio's count of the changes of target the document has seen (`targetGeneration`). */
  generation: number;
  /** The target the latest answer handed to the area names; `undefined` while it names none. */
  target: string | undefined;
  /** The element that holds the routed page, outside what is mounted again. */
  page: RefObject<HTMLElement | null>;
  /** Moves focus to the page's content target. */
  focusTarget: () => void;
  /** Shows a result in the area's flash. */
  show: (result: FlashResult) => void;
}

/**
 * What the area does on a change of target seen while it is mounted (issue 486, R3), beside the page's remount, which
 * the layout makes with `key={generation}`: focus that was inside the page, and so went with it, moves to the content
 * target; focus anywhere else stays. The flash then says which target the page was read from, once the connection the
 * area is handed names a target other than the one before the change: the generation and the answer that names the
 * new target may reach the area in different renders. A generation the area mounted with is no change: no flash.
 */
export function useTargetChange({ generation, target, page, focusTarget, show }: TargetChange) {
  // Whether the element focused last was inside the page: once the page is mounted again, it is no longer in the
  // document, and the document's focus is on its body.
  const focusInPage = useRef(false);
  useEffect(() => {
    const handleFocusIn = (event: FocusEvent) => {
      focusInPage.current = event.target instanceof Node && page.current?.contains(event.target) === true;
    };
    document.addEventListener('focusin', handleFocusIn);
    return () => {
      document.removeEventListener('focusin', handleFocusIn);
    };
  }, [page]);

  const seen = useRef({ generation, before: target, pending: false });
  // Before paint, right after the commit that mounted the page again.
  useLayoutEffect(() => {
    const now = seen.current;
    if (generation !== now.generation) {
      now.generation = generation;
      now.pending = true;
      const active = document.activeElement;
      if (focusInPage.current && (active === null || active === document.body)) {
        focusTarget();
      }
    }
    if (now.pending && target !== undefined && target !== now.before) {
      now.pending = false;
      show(targetChangedResult(target));
    }
    if (!now.pending && target !== undefined) {
      now.before = target;
    }
  }, [generation, target, focusTarget, show]);
}
