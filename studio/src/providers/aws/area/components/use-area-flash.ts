import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import type { FlashItem, FlashResult, HandOverNote, PageFlash } from './page-flash';

/** A result the area holds: for the visit and the path it belongs to, its items each under a key of their own. */
export interface HeldResult {
  id: number;
  /** The route change (Studio's `routeChanges`) of the visit the result is shown on. */
  visit: number;
  /** The path it is shown at. */
  path: string;
  handOver?: { note: HandOverNote; targetGeneration: number };
  items: { key: string; item: FlashItem }[];
}

/** The path of an address of the area, its query and fragment left out. */
function pathOf(to: string): string {
  return to.split(/[?#]/, 1)[0] ?? to;
}

/** What the area's layout holds of its flash. */
export interface AreaFlashState {
  /** What a screen's page is handed to show a result (`PageFlashContext`). */
  pageFlash: PageFlash;
  note: HandOverNote | undefined;
  /** The result to show now; `null` when there is none, and the region renders nothing. */
  shown: HeldResult | null;
  /** Removes one item of the result shown. */
  dismiss: (key: string) => void;
  /** Records what the status announcer says of the result `id`. */
  announce: (id: number, text: string) => void;
  /** What the status announcer says now: of the result shown, `''` while none is. */
  announcement: { id: number; text: string };
}

/**
 * The area's flash (R5): one result at a time, shown on a screen's page only (R5.2), for the visit of the path it was
 * shown on. A visit is counted by Studio's route changes, which grow with each change of path and not with a change of
 * the query, so a result is gone after any change of path, and coming back to the path is a new visit (R5.5). A
 * handed result belongs to the next visit, at the path it was handed to: after one route change there it is shown,
 * after one to anywhere else it never is (R5.6). Everything is held in the layout's state; nothing is stored, so a
 * reload of the document shows none.
 */
export function useAreaFlash(
  pathname: string,
  routeChanges: number,
  isScreen: boolean,
  targetGeneration = 0,
): AreaFlashState {
  const navigate = useNavigate();
  const lastId = useRef(0);
  const [held, setHeld] = useState<HeldResult | null>(null);

  const hold = useCallback((visit: number, path: string, result: FlashResult, handOver?: HeldResult['handOver']) => {
    lastId.current += 1;
    const id = lastId.current;
    setHeld({
      id,
      visit,
      path,
      items: result.map((item, index) => ({ key: `${String(id)}-${String(index)}`, item })),
      ...(handOver && { handOver }),
    });
  }, []);

  const pageFlash = useMemo<PageFlash>(
    () => ({
      show: (result) => {
        hold(routeChanges, pathname, result);
      },
      handOver: (to, result, note) => {
        const path = pathOf(to);
        // To the path shown already there is no route change to wait for: the result is this visit's.
        hold(
          path === pathname ? routeChanges : routeChanges + 1,
          path,
          result,
          note === undefined ? undefined : { note, targetGeneration },
        );
        void navigate(to);
      },
    }),
    [hold, navigate, pathname, routeChanges, targetGeneration],
  );

  const dismiss = useCallback((key: string) => {
    setHeld((current) => current && { ...current, items: current.items.filter((held) => held.key !== key) });
  }, []);

  const [said, setSaid] = useState({ id: 0, text: '' });
  const announce = useCallback((id: number, text: string) => {
    setSaid({ id, text });
  }, []);

  const current =
    isScreen &&
    held !== null &&
    held.visit === routeChanges &&
    held.path === pathname &&
    (held.handOver === undefined || held.handOver.targetGeneration === targetGeneration)
      ? held
      : null;
  const shown = current !== null && current.items.length > 0 ? current : null;
  const announcement = shown !== null && said.id === shown.id ? said : { id: 0, text: '' };
  return { pageFlash, note: current?.handOver?.note, shown, dismiss, announce, announcement };
}
