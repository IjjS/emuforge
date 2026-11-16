import { createContext, useContext } from 'react';

/**
 * Opens the area's help panel with the screen's help and moves focus into it; closing the panel returns focus to
 * `opener`, the control that asked (requirement R5.6). Without `opener`, the element that has focus when it is called.
 */
export type OpenHelp = (opener?: HTMLElement | null) => void;

/** Where a screen of the area asks for its help: the area's layout. Outside it, and on a page without help, nothing opens. */
export const PageHelpContext = createContext<OpenHelp>(() => undefined);

/** What a screen's "Info" control calls to open the screen's help in the area's help panel. */
export function usePageHelp(): OpenHelp {
  return useContext(PageHelpContext);
}
