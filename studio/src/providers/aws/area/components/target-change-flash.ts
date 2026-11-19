import { createContext } from 'react';

/**
 * Whether the area's flash announces a change of target on the page shown (issue 486, R2, R3): `true` on a screen's
 * page, where the flash says "The target is now …", so the emulator line's live region says nothing of a change of
 * the target alone; `false` on the area's own pages (its index, "no screen yet", "Page not found"), which show no
 * flash, so the line announces that change itself. Outside the area's layout the flash is taken to carry it.
 */
export const TargetChangeFlashContext = createContext(true);
