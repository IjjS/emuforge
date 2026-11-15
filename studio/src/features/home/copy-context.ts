import { createContext, useContext } from 'react';

import type { MessageKey } from '../../i18n/catalogue';

/** The outcome of a copy: the command was copied, or it was not. */
export type CopyOutcome = 'done' | 'failed';

/** What the copy region and a copy button say for each outcome. */
export const COPY_SAID: Readonly<Record<CopyOutcome, MessageKey>> = { done: 'copy.done', failed: 'copy.failed' };

/**
 * Says the outcome of a copy through the polite copy region of the section the command sits in, which words it in
 * the current language.
 */
export type AnnounceCopy = (outcome: CopyOutcome) => void;

export const CopyAnnouncerContext = createContext<AnnounceCopy>(() => undefined);

/** The section's copy announcer; outside a `CopyRegion` it says nothing. */
export function useAnnounceCopy(): AnnounceCopy {
  return useContext(CopyAnnouncerContext);
}
