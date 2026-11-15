import { createContext, useContext } from 'react';

/** Says the outcome of a copy through the polite copy region of the section the command sits in. */
export type AnnounceCopy = (text: string) => void;

export const CopyAnnouncerContext = createContext<AnnounceCopy>(() => undefined);

/** The section's copy announcer; outside a `CopyRegion` it says nothing. */
export function useAnnounceCopy(): AnnounceCopy {
  return useContext(CopyAnnouncerContext);
}
