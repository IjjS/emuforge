import { createContext, useContext, type ReactNode } from 'react';

/** The kind of an item of the area's flash (issue 386, R5.4). */
export type FlashType = 'success' | 'error' | 'info' | 'warning';

/**
 * One item of a result: its type, its content and, optionally, a header, each text or elements the page gives. Text
 * from the emulator inside them is rendered as text, as React renders every string.
 */
export interface FlashItem {
  type: FlashType;
  header?: ReactNode;
  content: ReactNode;
}

/** What a page shows at once (R5.3): one item, or several items of one action, in the order they are shown. */
export type FlashResult = readonly [FlashItem, ...FlashItem[]];

/** What a screen's page asks of the area's flash. */
export interface PageFlash {
  /**
   * Shows `result` in the area's flash, in place of every item shown (R5.3). It stays while the address's path stays
   * the same, a change of the query alone included, and is gone after any change of path (R5.5).
   */
  show: (result: FlashResult) => void;
  /**
   * Leads to `to`, an address of the area, and shows `result` on the page there after that one route change (R5.6).
   * If the next change of path goes anywhere else the result is dropped; once shown, it lasts as `show` says.
   */
  handOver: (to: string, result: FlashResult) => void;
}

const NO_FLASH: PageFlash = { show: () => undefined, handOver: () => undefined };

/**
 * Where a screen's page shows a result: the area's frame, which holds the flash inside the content target after the
 * emulator line and the notice and before the page's `h1` (R5.1). Outside the frame nothing listens.
 */
export const PageFlashContext = createContext<PageFlash>(NO_FLASH);

/** What a screen's page calls to show the result of an action, or to hand it to the page it leads to (R5.2). */
export function usePageFlash(): PageFlash {
  return useContext(PageFlashContext);
}
